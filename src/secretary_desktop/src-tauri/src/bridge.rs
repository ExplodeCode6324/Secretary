use crate::{
    discovery::{self, Profile},
    err,
    protocol::{self, Query},
    storage::Storage,
    sync::Synchronizer,
    transport::Transport,
    Result,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
pub struct Bridge {
    pub profiles: Vec<Profile>,
    root: PathBuf,
    pub storage: Option<Storage>,
    pub transport: Option<Transport>,
    pub sync: Synchronizer,
    pub active: Option<String>,
    pub error: Option<String>,
    stopped: bool,
    retry_at: std::time::Instant,
    attempts: u32,
}
impl Bridge {
    pub fn new(root: &Path) -> Result<Self> {
        discovery::private_dir(root)?;
        let profiles = discovery::profiles(&root.join("profiles.json"))?;
        Ok(Self {
            profiles,
            root: root.into(),
            storage: None,
            transport: None,
            sync: Synchronizer::default(),
            active: None,
            error: None,
            stopped: false,
            retry_at: std::time::Instant::now(),
            attempts: 0,
        })
    }
    pub fn connect(&mut self, id: &str, start: bool) -> Result<Value> {
        if self.active.as_deref() != Some(id) {
            self.sync = Synchronizer::default();
        }
        self.sync.reset();
        self.transport = None;
        self.storage = None;
        self.active = None;
        self.stopped = false;
        let profile = self
            .profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| err("INVALID_PROFILE"))?;
        let t = if start {
            Transport::start(profile)?
        } else {
            Transport::attach(profile)?
        };
        let mut storage = Storage::open(&self.root.join(id))?;
        storage.bind(t.domain(), t.instance())?;
        self.active = Some(id.into());
        self.storage = Some(storage);
        self.transport = Some(t);
        self.error = None;
        self.retry_at = std::time::Instant::now();
        self.tick();
        self.snapshot()
    }
    pub fn tick(&mut self) {
        if self.stopped || std::time::Instant::now() < self.retry_at {
            return;
        }
        if self.error.as_deref() == Some("NETWORK_UNAVAILABLE") {
            if let Some(profile) = self
                .profiles
                .iter()
                .find(|p| Some(&p.id) == self.active.as_ref())
            {
                match Transport::attach(profile) {
                    Ok(t) => {
                        if self
                            .transport
                            .as_ref()
                            .is_some_and(|old| old.domain() != t.domain())
                        {
                            self.error = Some("DATA_DOMAIN_CONFLICT".into());
                            return;
                        }
                        if let Some(storage) = &mut self.storage {
                            if let Err(e) = storage.bind(t.domain(), t.instance()) {
                                self.error = Some(e);
                                return;
                            }
                        }
                        if self
                            .transport
                            .as_ref()
                            .is_some_and(|old| old.instance() != t.instance())
                        {
                            for query in &mut self.sync.subscriptions {
                                query.parameters.remove("cursor");
                            }
                        }
                        self.transport = Some(t);
                        self.sync.reset();
                    }
                    Err(e) => {
                        self.error = Some(if e == "ENDPOINT_MISSING" {
                            "NETWORK_UNAVAILABLE".into()
                        } else {
                            e
                        });
                        self.retry_at =
                            std::time::Instant::now() + std::time::Duration::from_secs(3);
                        return;
                    }
                }
            }
        }
        if self.error.as_deref().is_some_and(|e| {
            [
                "UNAUTHENTICATED",
                "FORBIDDEN_ORIGIN",
                "DATA_DOMAIN_CONFLICT",
                "UNSUPPORTED_SYNC",
            ]
            .contains(&e)
        }) {
            return;
        }

        let result = (|| {
            let t = self.transport.as_ref().ok_or_else(|| err("DISCONNECTED"))?;
            let storage = self.storage.as_mut().ok_or_else(|| err("DISCONNECTED"))?;
            // Synchronize before replay: invalid history must never erase accepted evidence.
            self.sync.tick(t, storage)?;
            deliver(t, storage)?;
            storage.cleanup()
        })();
        self.error = result.err();
        if self.error.is_some() {
            self.attempts = (self.attempts + 1).min(5);
            self.retry_at = std::time::Instant::now()
                + std::time::Duration::from_millis(
                    (1 << self.attempts) * 200 + u64::from(uuid::Uuid::new_v4().as_bytes()[0]),
                );
        } else {
            self.attempts = 0;
        }
    }
    pub fn enqueue_context(&self) -> Result<(PathBuf, Transport)> {
        if self.stopped {
            return Err(err("DISCONNECTED"));
        }
        if self.error.as_deref().is_some_and(|e| {
            [
                "UNAUTHENTICATED",
                "FORBIDDEN_ORIGIN",
                "DATA_DOMAIN_CONFLICT",
                "IDENTITY_MISMATCH",
                "CORE_MODE_MISMATCH",
                "UNSUPPORTED_SYNC",
            ]
            .contains(&e)
        }) {
            return Err(self.error.clone().expect("checked"));
        }
        Ok((
            self.draft_context()?.0,
            self.transport.clone().ok_or_else(|| err("DISCONNECTED"))?,
        ))
    }
    pub fn draft_context(&self) -> Result<(PathBuf, String)> {
        let id = self.active.as_ref().ok_or_else(|| err("DISCONNECTED"))?;
        let t = self.transport.as_ref().ok_or_else(|| err("DISCONNECTED"))?;
        Ok((self.root.join(id), t.domain().into()))
    }
    pub fn snapshot(&self) -> Result<Value> {
        let mut v = if let (Some(t), Some(s)) = (&self.transport, &self.storage) {
            s.snapshot(t.domain())?
        } else {
            json!({})
        };
        v["profiles"] = json!(self
            .profiles
            .iter()
            .map(|p| json!({"id":p.id,"mode":p.expected_mode}))
            .collect::<Vec<_>>());
        v["profile"] = json!(self.active);
        v["error"] = json!(self.error);
        v["sync"] = json!(self.sync.status);
        v["transient"] = self.sync.transient.clone();
        v["core"] = self
            .transport
            .as_ref()
            .map(|t| t.core.clone())
            .unwrap_or(Value::Null);
        Ok(v)
    }
    pub fn save_draft(&mut self, version: i64, text: &str) -> Result<Value> {
        let t = self.transport.as_ref().ok_or_else(|| err("DISCONNECTED"))?;
        self.storage
            .as_mut()
            .ok_or_else(|| err("DISCONNECTED"))?
            .save_draft(t.domain(), "message", version, text)
    }
    pub fn submit(&mut self, q: Query, body: Value, draft_version: Option<i64>) -> Result<String> {
        if self.stopped {
            return Err(err("DISCONNECTED"));
        }
        if q.operation == "core/stop" {
            return Err(err("USE_EXPLICIT_STOP"));
        }
        let t = self.transport.as_ref().ok_or_else(|| err("DISCONNECTED"))?;
        if let Some(e) = &self.error {
            if [
                "UNAUTHENTICATED",
                "FORBIDDEN_ORIGIN",
                "IDENTITY_MISMATCH",
                "CORE_MODE_MISMATCH",
            ]
            .contains(&e.as_str())
            {
                return Err(e.clone());
            }
        }
        enqueue(
            t,
            self.storage.as_mut().ok_or_else(|| err("DISCONNECTED"))?,
            &q,
            body,
            draft_version,
        )
    }

    pub fn stop(&mut self) -> Result<Value> {
        let t = self.transport.as_ref().ok_or_else(|| err("DISCONNECTED"))?;
        let s = self.storage.as_mut().ok_or_else(|| err("DISCONNECTED"))?;
        let q = Query::new("core/stop");
        let body = json!({"request_id":uuid::Uuid::new_v4().to_string()});
        let id = s.enqueue(t.domain(), t.instance(), &q, &body, None, true)?;
        s.mark(&id, "STOP_SENT", None)?;
        match t.post(&q, &body) {
            Ok(receipt) => {
                s.mark(&id, "STOP_ACCEPTED", Some(&receipt))?;
            }
            Err(_) => {
                s.mark(&id, "STOP_UNKNOWN", None)?;
            }
        }
        let profile = self
            .profiles
            .iter()
            .find(|p| Some(&p.id) == self.active.as_ref());
        let mut disconnected = false;
        for _ in 0..20 {
            if profile.is_some_and(|p| !p.data_dir.join("core-endpoint.json").exists())
                && t.query(&Query::new("core")).is_err()
            {
                disconnected = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        self.sync.disconnect();
        self.error = Some(
            if disconnected {
                "STOP_DISCONNECTED"
            } else {
                "STOP_REQUESTED_RECHECK"
            }
            .into(),
        );
        self.stopped = true;
        Ok(json!({"request_id":id,"status":self.error}))
    }
    pub fn query(&self, q: &Query) -> Result<Value> {
        self.transport
            .as_ref()
            .ok_or_else(|| err("DISCONNECTED"))?
            .query(q)
    }
    pub fn subscribe(&mut self, queries: Vec<Query>) -> Result<()> {
        if queries.len() > 16 {
            return Err(err("SUBSCRIPTION_QUOTA"));
        }
        for q in &queries {
            protocol::route("GET", q)?;
            if q.operation.starts_with("sync/")
                || q.operation.starts_with("requests/")
                || q.operation.ends_with("/content")
            {
                return Err(err("INVALID_SUBSCRIPTION"));
            }
        }
        let t = self.transport.as_ref().ok_or_else(|| err("DISCONNECTED"))?;
        for query in &queries {
            t.capability(&query.operation)?;
        }
        self.storage
            .as_ref()
            .ok_or_else(|| err("DISCONNECTED"))?
            .clear_cache(t.domain())?;
        self.sync.subscriptions = queries;
        self.sync.reset();
        self.error = None;
        self.attempts = 0;
        self.retry_at = std::time::Instant::now();
        Ok(())
    }
    pub fn anchor(&self, value: &str) -> Result<()> {
        let t = self.transport.as_ref().ok_or_else(|| err("DISCONNECTED"))?;
        self.storage
            .as_ref()
            .ok_or_else(|| err("DISCONNECTED"))?
            .anchor(t.domain(), value)
    }
}
pub fn deliver(t: &Transport, s: &mut Storage) -> Result<()> {
    let Some(_claim) = s.claim_delivery()? else {
        return Ok(());
    };
    let mut processed = 0;
    for row in s.pending(t.domain())? {
        if row["stop"] == true {
            continue;
        }
        let state = row["state"].as_str().unwrap_or("");
        if ![
            "PENDING",
            "SENDING",
            "UNCERTAIN",
            "VERIFY_ACCEPTED",
            "TRACKING",
        ]
        .contains(&state)
        {
            continue;
        }
        if processed >= 8 {
            break;
        }
        processed += 1;
        let id = row["id"].as_str().ok_or_else(|| err("INVALID_STORAGE"))?;
        let mut receipt_q = Query::new("requests/{id}");
        receipt_q.id = Some(id.into());
        match t.query(&receipt_q) {
            Ok(result) => {
                let receipt = &result["receipt"];
                let state = receipt["state"].as_str().unwrap_or("UNKNOWN");
                let mark = match state {
                    "UNKNOWN" => "UNKNOWN",
                    "QUEUED" | "RUNNING" => "TRACKING",
                    "ACCEPTED" => "ACCEPTED",
                    "COMPLETED" => "COMPLETED",
                    "FAILED" => "FAILED",
                    _ => "UNSUPPORTED_RECEIPT",
                };
                s.mark(id, mark, Some(receipt))?;
                continue;
            }
            Err(e) if e == "NOT_FOUND" => {
                if row["accepted"] == true {
                    s.mark(id, "RECEIPT_MISSING", None)?;
                    continue;
                }
            }
            Err(e) => return Err(e),
        }
        let q: Query = serde_json::from_str(row["query"].as_str().unwrap_or(""))
            .map_err(|_| err("INVALID_STORAGE"))?;
        let body: Value = serde_json::from_str(row["body"].as_str().unwrap_or(""))
            .map_err(|_| err("INVALID_STORAGE"))?;
        s.mark(id, "SENDING", None)?;
        match t.post(&q, &body) {
            Ok(receipt) => {
                let state = match receipt["state"].as_str() {
                    Some("UNKNOWN") => "UNKNOWN",
                    Some("QUEUED" | "RUNNING") => "TRACKING",
                    Some("ACCEPTED") => "ACCEPTED",
                    Some("COMPLETED") => "COMPLETED",
                    Some("FAILED") => "FAILED",
                    _ => "UNSUPPORTED_RECEIPT",
                };
                s.mark(id, state, Some(&receipt))?;
            }
            Err(e) => {
                let mark = match e.as_str() {
                    "NETWORK_UNAVAILABLE"
                    | "CORE_REQUEST_FAILED"
                    | "INVALID_RESPONSE"
                    | "RESPONSE_TOO_LARGE" => "UNCERTAIN",
                    "UNAUTHENTICATED" | "FORBIDDEN_ORIGIN" => "UNCERTAIN",
                    _ => "REJECTED",
                };
                s.mark(id, if mark == "REJECTED" { &e } else { mark }, None)?;
                if mark == "UNCERTAIN" {
                    return Err(e);
                }
            }
        }
    }
    Ok(())
}

pub fn enqueue(
    t: &Transport,
    storage: &mut Storage,
    q: &Query,
    mut body: Value,
    draft_version: Option<i64>,
) -> Result<String> {
    if q.operation == "core/stop" {
        return Err(err("USE_EXPLICIT_STOP"));
    }
    body["request_id"] = json!(uuid::Uuid::new_v4().to_string());
    protocol::command(q, &body)?;
    t.capability(&q.operation)?;
    if draft_version.is_some() && q.operation != "messages" {
        return Err(err("INVALID_COMMAND"));
    }
    storage.enqueue(
        t.domain(),
        t.instance(),
        q,
        &body,
        draft_version.map(|v| ("message", v)),
        false,
    )
}
