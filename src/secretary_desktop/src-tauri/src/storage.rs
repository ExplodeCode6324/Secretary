use crate::{discovery, err, protocol::Query, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;
use uuid::Uuid;
pub struct Storage {
    pub db: Connection,
}
fn sql<T>(r: rusqlite::Result<T>) -> Result<T> {
    r.map_err(|_| err("STORAGE_UNAVAILABLE"))
}
impl Storage {
    pub fn open(dir: &Path) -> Result<Self> {
        discovery::private_dir(dir)?;
        let file = dir.join("client.sqlite");
        if !file.exists() {
            discovery::secure_file(&file)?;
        }
        for name in ["client.sqlite", "client.sqlite-wal", "client.sqlite-shm"] {
            let p = dir.join(name);
            if p.exists() {
                let m = std::fs::symlink_metadata(&p).map_err(|_| err("UNSAFE_STORAGE"))?;
                if !m.is_file() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
                    return Err(err("UNSAFE_STORAGE"));
                }
            }
        }
        let db = sql(Connection::open(&file))?;
        sql(db.busy_timeout(std::time::Duration::from_secs(2)))?;
        let version: i64 = sql(db.pragma_query_value(None, "user_version", |r| r.get(0)))?;
        if version > 1 {
            return Err(err("UNSUPPORTED_STORAGE_VERSION"));
        }
        sql(db.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        ))?;
        if version == 0 {
            sql(db.execute_batch("BEGIN IMMEDIATE;
CREATE TABLE domains(domain TEXT PRIMARY KEY, instance TEXT NOT NULL, cursor TEXT, client TEXT NOT NULL);
CREATE TABLE drafts(domain TEXT NOT NULL, key TEXT NOT NULL, version INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(domain,key));
CREATE TABLE anchors(domain TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE cache(domain TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(domain,key));
CREATE TABLE outbox(id TEXT PRIMARY KEY,domain TEXT NOT NULL,instance TEXT NOT NULL,query TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,receipt TEXT, accepted INTEGER NOT NULL DEFAULT 0,stop INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL DEFAULT (unixepoch()),updated INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE INDEX outbox_domain ON outbox(domain,state);
PRAGMA user_version=1; COMMIT;"))?;
        }
        for name in ["client.sqlite-wal", "client.sqlite-shm"] {
            let p = dir.join(name);
            if p.exists() {
                std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o600))
                    .map_err(|_| err("UNSAFE_STORAGE"))?;
            }
        }
        // A stop is never replayed after process restart, even if the crash happened before send.
        sql(db.execute(
            "UPDATE outbox SET state='STOP_RECONFIRM' WHERE stop=1 AND receipt IS NULL",
            [],
        ))?;
        Ok(Self { db })
    }
    pub fn bind(&mut self, domain: &str, instance: &str) -> Result<()> {
        let tx = sql(self.db.transaction())?;
        let other: i64 = sql(tx.query_row(
            "SELECT count(*) FROM domains WHERE domain != ?",
            [domain],
            |r| r.get(0),
        ))?;
        if other > 0 {
            return Err(err("DATA_DOMAIN_CONFLICT"));
        }
        sql(tx.execute(
            "UPDATE outbox SET state='VERIFY_ACCEPTED' WHERE state='ACCEPTED' AND domain=?",
            [domain],
        ))?;
        let old: Option<String> = sql(tx
            .query_row(
                "SELECT instance FROM domains WHERE domain=?",
                [domain],
                |r| r.get(0),
            )
            .optional())?;
        if old.as_deref().is_some_and(|s| s != instance) {
            sql(tx.execute("DELETE FROM cache WHERE domain=?", [domain]))?;
        }
        sql(tx.execute("INSERT INTO domains(domain,instance,client) VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET instance=excluded.instance",params![domain,instance,Uuid::new_v4().to_string()]))?;
        sql(tx.commit())
    }
    pub fn cursor(&self, domain: &str) -> Result<Option<String>> {
        sql(self
            .db
            .query_row("SELECT cursor FROM domains WHERE domain=?", [domain], |r| {
                r.get(0)
            }))
    }
    pub fn draft(&self, domain: &str, key: &str) -> Result<Value> {
        Ok(sql(self
            .db
            .query_row(
                "SELECT version,text FROM drafts WHERE domain=? AND key=?",
                params![domain, key],
                |r| Ok(json!({"version":r.get::<_,i64>(0)?,"text":r.get::<_,String>(1)?})),
            )
            .optional())?
        .unwrap_or(json!({"version":0,"text":""})))
    }
    pub fn save_draft(
        &mut self,
        domain: &str,
        key: &str,
        version: i64,
        text: &str,
    ) -> Result<Value> {
        if key.len() > 128 || text.len() > 1024 * 1024 {
            return Err(err("DRAFT_QUOTA"));
        }
        let tx = sql(self.db.transaction())?;
        let old: i64 = sql(tx
            .query_row(
                "SELECT version FROM drafts WHERE domain=? AND key=?",
                params![domain, key],
                |r| r.get(0),
            )
            .optional())?
        .unwrap_or(0);
        if old != version {
            return Err(err("DRAFT_CONFLICT"));
        }
        let bytes: i64 = sql(tx.query_row(
            "SELECT coalesce(sum(length(CAST(text AS BLOB))),0) FROM drafts",
            [],
            |r| r.get(0),
        ))?;
        if bytes + text.len() as i64 > 16 * 1024 * 1024 {
            return Err(err("DRAFT_QUOTA"));
        }
        sql(tx.execute("INSERT INTO drafts VALUES(?,?,?,?) ON CONFLICT(domain,key) DO UPDATE SET version=excluded.version,text=excluded.text",params![domain,key,version+1,text]))?;
        sql(tx.commit())?;
        self.draft(domain, key)
    }
    pub fn enqueue(
        &mut self,
        domain: &str,
        instance: &str,
        q: &Query,
        body: &Value,
        draft: Option<(&str, i64)>,
        stop: bool,
    ) -> Result<String> {
        let id = body["request_id"]
            .as_str()
            .ok_or_else(|| err("INVALID_COMMAND"))?;
        let tx = sql(self.db.transaction())?;
        let (count, bytes): (i64, i64) = sql(tx.query_row(
            "SELECT count(*),coalesce(sum(length(CAST(body AS BLOB))),0) FROM outbox",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ))?;
        if count >= 1000 || bytes + body.to_string().len() as i64 > 32 * 1024 * 1024 {
            return Err(err("OUTBOX_QUOTA"));
        }
        if let Some((key, version)) = draft {
            let old: Option<(i64, String)> = sql(tx
                .query_row(
                    "SELECT version,text FROM drafts WHERE domain=? AND key=?",
                    params![domain, key],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional())?;
            if !old
                .as_ref()
                .is_some_and(|(v, t)| *v == version && body["text"] == *t)
            {
                return Err(err("DRAFT_CONFLICT"));
            }
            sql(tx.execute("UPDATE drafts SET text='',version=version+1 WHERE domain=? AND key=? AND version=?",params![domain,key,version]))?;
        }
        sql(tx.execute("INSERT INTO outbox(id,domain,instance,query,body,state,stop) VALUES(?,?,?,?,?,'PENDING',?)",params![id,domain,instance,q.key(),body.to_string(),stop]))?;
        sql(tx.commit())?;
        Ok(id.into())
    }
    pub fn rows(&self, domain: &str) -> Result<Vec<Value>> {
        let mut st=sql(self.db.prepare("SELECT id,query,body,state,receipt,accepted,stop,instance FROM outbox WHERE domain=? ORDER BY updated,id"))?;
        let values=sql(st.query_map([domain],|r|Ok(json!({"id":r.get::<_,String>(0)?,"query":r.get::<_,String>(1)?,"body":r.get::<_,String>(2)?,"state":r.get::<_,String>(3)?,"receipt":r.get::<_,Option<String>>(4)?,"accepted":r.get::<_,bool>(5)?,"stop":r.get::<_,bool>(6)?,"instance":r.get::<_,String>(7)?}))))?;
        values.map(sql).collect()
    }
    pub fn mark(&self, id: &str, state: &str, receipt: Option<&Value>) -> Result<()> {
        sql(self.db.execute("UPDATE outbox SET state=?,receipt=coalesce(?,receipt),accepted=max(accepted,?),updated=unixepoch() WHERE id=?",params![state,receipt.map(Value::to_string),receipt.is_some(),id]))?;
        Ok(())
    }
    pub fn project(
        &mut self,
        domain: &str,
        cursor: &str,
        values: &[(Query, Value)],
        reset: bool,
    ) -> Result<()> {
        let tx = sql(self.db.transaction())?;
        if reset {
            sql(tx.execute("DELETE FROM cache WHERE domain=?", [domain]))?;
        }
        for (q, v) in values {
            sql(tx.execute("INSERT INTO cache VALUES(?,?,?) ON CONFLICT(domain,key) DO UPDATE SET value=excluded.value",params![domain,q.key(),v.to_string()]))?;
        }
        let (count, bytes): (i64, i64) = sql(tx.query_row(
            "SELECT count(*),coalesce(sum(length(CAST(value AS BLOB))),0) FROM cache",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ))?;
        if count > 10000 || bytes > 64 * 1024 * 1024 {
            return Err(err("CACHE_QUOTA"));
        }
        sql(tx.execute(
            "UPDATE domains SET cursor=? WHERE domain=?",
            params![cursor, domain],
        ))?;
        sql(tx.commit())
    }
    pub fn clear_cache(&self, domain: &str) -> Result<()> {
        sql(self.db.execute_batch("BEGIN IMMEDIATE"))?;
        let result = (|| {
            sql(self
                .db
                .execute("DELETE FROM cache WHERE domain=?", [domain]))?;
            sql(self.db.execute(
                "UPDATE outbox SET state='VERIFY_ACCEPTED' WHERE state='ACCEPTED' AND domain=?",
                [domain],
            ))?;
            sql(self
                .db
                .execute("UPDATE domains SET cursor=NULL WHERE domain=?", [domain]))?;
            Ok(())
        })();
        if result.is_ok() {
            sql(self.db.execute_batch("COMMIT"))?;
        } else {
            let _ = self.db.execute_batch("ROLLBACK");
        }
        result
    }
    pub fn snapshot(&self, domain: &str) -> Result<Value> {
        let mut st = sql(self
            .db
            .prepare("SELECT key,value FROM cache WHERE domain=?"))?;
        let rows = sql(st.query_map([domain], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }))?;
        let mut cache = serde_json::Map::new();
        for row in rows {
            let (k, v) = sql(row)?;
            cache.insert(
                k,
                serde_json::from_str(&v).map_err(|_| err("INVALID_STORAGE"))?,
            );
        }
        let anchor: Option<String> = sql(self
            .db
            .query_row("SELECT value FROM anchors WHERE domain=?", [domain], |r| {
                r.get(0)
            })
            .optional())?;
        Ok(
            json!({"domain":domain,"cursor":self.cursor(domain)?,"draft":self.draft(domain,"message")?,"outbox":self.rows(domain)?,"cache":cache,"anchor":anchor}),
        )
    }
    pub fn anchor(&self, domain: &str, value: &str) -> Result<()> {
        if value.len() > 1024 {
            return Err(err("INVALID_ANCHOR"));
        }
        sql(self.db.execute("INSERT INTO anchors VALUES(?,?) ON CONFLICT(domain) DO UPDATE SET value=excluded.value",params![domain,value]))?;
        Ok(())
    }
    pub fn cleanup(&self) -> Result<()> {
        sql(self.db.execute(
            "DELETE FROM outbox WHERE state='ACCEPTED' AND created<unixepoch()-2592000",
            [],
        ))?;
        Ok(())
    }
}
