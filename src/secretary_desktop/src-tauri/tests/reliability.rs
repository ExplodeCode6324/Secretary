use secretary_desktop_spike::{
    bridge::{deliver, Bridge},
    discovery::{self, Profile},
    protocol::{self, Query},
    storage::Storage,
    sync::{Parser, Synchronizer},
    transport::Transport,
};
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
    path::{Path, PathBuf},
    process::Command,
};
use tempfile::TempDir;
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}
fn profile(dir: &Path) -> Profile {
    Profile {
        id: "fixture".into(),
        data_dir: dir.into(),
        expected_mode: "fixture".into(),
        node_abs: PathBuf::from(
            String::from_utf8(
                Command::new("node")
                    .args(["-p", "process.execPath"])
                    .output()
                    .unwrap()
                    .stdout,
            )
            .unwrap()
            .trim(),
        ),
        core_root: root(),
        backend_entry: root().join("src/pi_secretary/src/backend.ts"),
    }
}
struct Fixture {
    tmp: TempDir,
    p: Profile,
    t: Transport,
}
impl Fixture {
    fn new() -> Self {
        let tmp = tempfile::tempdir().unwrap();
        let p = profile(&tmp.path().join("core"));
        let t = Transport::start(&p).unwrap();
        Self { tmp, p, t }
    }
    fn restart(&mut self) {
        let _ = self.t.post(
            &Query::new("core/stop"),
            &json!({"request_id":uuid::Uuid::new_v4().to_string()}),
        );
        for _ in 0..100 {
            if !self.p.data_dir.join("core-endpoint.json").exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
        self.t = Transport::start(&self.p).unwrap();
    }
    fn store(&self, name: &str) -> Storage {
        let mut s = Storage::open(&self.tmp.path().join(name)).unwrap();
        s.bind(self.t.domain(), self.t.instance()).unwrap();
        s
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.t.post(
            &Query::new("core/stop"),
            &json!({"request_id":uuid::Uuid::new_v4().to_string()}),
        );
    }
}
#[test]
fn endpoint_permissions_mode_and_origin() {
    let f = Fixture::new();
    fs::set_permissions(&f.p.data_dir, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(Transport::attach(&f.p).is_ok());
    let path = f.p.data_dir.join("core-endpoint.json");
    let raw = fs::read(&path).unwrap();
    let e: Value = serde_json::from_slice(&raw).unwrap();
    let mut p = f.p.clone();
    p.expected_mode = "live".into();
    assert_eq!(Transport::attach(&p).err().unwrap(), "CORE_MODE_MISMATCH");
    let client = reqwest::blocking::Client::new();
    for header in ["host", "origin"] {
        let r = client
            .get(format!("{}/api/v1/core", e["url"].as_str().unwrap()))
            .bearer_auth(e["token"].as_str().unwrap())
            .header(header, "http://evil.invalid")
            .send()
            .unwrap();
        assert_eq!(r.status(), 403);
    }
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(discovery::endpoint(&f.p).err().unwrap(), "UNSAFE_ENDPOINT");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let target = path.with_extension("real");
    fs::rename(&path, &target).unwrap();
    symlink(&target, &path).unwrap();
    assert!(discovery::endpoint(&f.p).is_err());
    fs::remove_file(&path).unwrap();
    fs::rename(target, path).unwrap();
}
#[test]
fn atomic_draft_enqueue_and_commit_failure() {
    let f = Fixture::new();
    let mut s = f.store("client");
    let d = s
        .save_draft(f.t.domain(), "message", 0, "durable message")
        .unwrap();
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"durable message"});
    s.db.execute_batch("CREATE TRIGGER fail_enqueue BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(s
        .enqueue(
            f.t.domain(),
            f.t.instance(),
            &Query::new("messages"),
            &body,
            Some(("message", d["version"].as_i64().unwrap())),
            false
        )
        .is_err());
    assert_eq!(
        s.draft(f.t.domain(), "message").unwrap()["text"],
        "durable message"
    );
    assert!(s.rows(f.t.domain()).unwrap().is_empty());
    s.db.execute_batch("DROP TRIGGER fail_enqueue").unwrap();
    assert!(s
        .enqueue(
            f.t.domain(),
            f.t.instance(),
            &Query::new("messages"),
            &body,
            Some(("message", 99)),
            false
        )
        .is_err());
    s.enqueue(
        f.t.domain(),
        f.t.instance(),
        &Query::new("messages"),
        &body,
        Some(("message", 1)),
        false,
    )
    .unwrap();
    assert_eq!(s.draft(f.t.domain(), "message").unwrap()["text"], "");
    drop(s);
    let mut s = f.store("client");
    deliver(&f.t, &mut s).unwrap();
    assert_eq!(s.rows(f.t.domain()).unwrap()[0]["state"], "ACCEPTED");
}
#[test]
fn response_lost_same_id_conflict_and_restart() {
    let mut f = Fixture::new();
    let mut s = f.store("client");
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"response lost"});
    s.enqueue(
        f.t.domain(),
        f.t.instance(),
        &Query::new("messages"),
        &body,
        None,
        false,
    )
    .unwrap();
    s.mark(body["request_id"].as_str().unwrap(), "SENDING", None)
        .unwrap();
    // Real Core commits; deliberately discard the response before local receipt commit.
    let receipt = f.t.post(&Query::new("messages"), &body).unwrap();
    drop(s);
    f.restart();
    let mut s = f.store("client");
    deliver(&f.t, &mut s).unwrap();
    let row = &s.rows(f.t.domain()).unwrap()[0];
    let saved: Value = serde_json::from_str(row["receipt"].as_str().unwrap()).unwrap();
    assert_eq!(saved["resource_ids"], receipt["resource_ids"]);
    assert_eq!(
        f.t.post(&Query::new("messages"), &body).unwrap()["resource_ids"],
        receipt["resource_ids"]
    );
    let mut changed = body.clone();
    changed["text"] = json!("different");
    assert_eq!(
        f.t.post(&Query::new("messages"), &changed).err().unwrap(),
        "REQUEST_CONFLICT"
    );
}
#[test]
fn sync_atomic_cursor_aggregate_and_two_clients() {
    let f = Fixture::new();
    let mut a = f.store("a");
    let mut b = f.store("b");
    let mut sync = Synchronizer::default();
    sync.tick(&f.t, &mut a).unwrap();
    let old = a.cursor(f.t.domain()).unwrap().unwrap();
    assert!(b.cursor(f.t.domain()).unwrap().is_none());
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"during sync"});
    f.t.post(&Query::new("messages"), &body).unwrap();
    a.db.execute_batch("CREATE TRIGGER fail_projection BEFORE UPDATE ON domains BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(sync.tick(&f.t, &mut a).is_err());
    assert_eq!(a.cursor(f.t.domain()).unwrap().unwrap(), old);
    a.db.execute_batch("DROP TRIGGER fail_projection").unwrap();
    sync.tick(&f.t, &mut a).unwrap();
    assert_ne!(a.cursor(f.t.domain()).unwrap().unwrap(), old);
    assert!(a
        .snapshot(f.t.domain())
        .unwrap()
        .to_string()
        .contains("during sync"));
    let mut second = Synchronizer::default();
    second.tick(&f.t, &mut b).unwrap();
    assert!(b
        .snapshot(f.t.domain())
        .unwrap()
        .to_string()
        .contains("during sync"));
}
#[test]
fn expired_token_and_invalid_cursor_preserve_intent() {
    let f = Fixture::new();
    let mut s = f.store("client");
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"retain"});
    s.enqueue(
        f.t.domain(),
        f.t.instance(),
        &Query::new("messages"),
        &body,
        None,
        false,
    )
    .unwrap();
    s.db.execute("UPDATE domains SET cursor='invalid'", [])
        .unwrap();
    let mut sync = Synchronizer::default();
    assert_eq!(sync.tick(&f.t, &mut s).err().unwrap(), "RESYNC_REQUIRED");
    assert_eq!(s.rows(f.t.domain()).unwrap().len(), 1);
    sync.tick(&f.t, &mut s).unwrap();
    let path = f.p.data_dir.join("core-endpoint.json");
    let raw = fs::read(&path).unwrap();
    let mut e: Value = serde_json::from_slice(&raw).unwrap();
    e["token"] = json!("a".repeat(64));
    fs::write(&path, e.to_string()).unwrap();
    assert_eq!(Transport::attach(&f.p).err().unwrap(), "UNAUTHENTICATED");
    fs::write(path, raw).unwrap();
}
#[test]
fn sse_split_unicode_transient_and_bounds() {
    let mut parser = Parser::default();
    let bytes="event: transient\ndata: {\"previews\":[\"中文😀\"]}\n\nevent: change\nid: x\ndata: {\"cursor\":\"x\",\"changes\":[]}\n\n".as_bytes();
    let mut events = vec![];
    for b in bytes {
        events.extend(parser.feed(&[*b]).unwrap());
    }
    assert_eq!(events.len(), 2);
    assert_eq!(events[0]["data"]["previews"][0], "中文😀");
    assert!(parser.feed(&vec![b'a'; 256 * 1024 + 16385]).is_err());
}
#[test]
fn protocol_precision_unknown_enums_and_route_controls() {
    assert!(protocol::route("GET", &Query::new("http://evil.invalid")).is_err());
    assert!(protocol::route("POST", &Query::new("admin/programs")).is_err());
    let mut q = Query::new("tasks/{id}");
    q.id = Some("../core".into());
    assert!(protocol::route("GET", &q).is_err());
    let v = json!({"request_id":uuid::Uuid::new_v4().to_string(),"command":"messages","acceptance":"ACCEPTED","state":"FUTURE","revision":"9007199254740993","resource_ids":[],"error_code":null});
    assert!(protocol::validate("Receipt", &v, true).is_ok());
    let mut v = v;
    v["revision"] = json!(9007199254740993u64);
    assert!(protocol::validate("Receipt", &v, true).is_err());
}
#[test]
fn actual_disk_full_preserves_draft() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Storage::open(&tmp.path().join("db")).unwrap();
    s.bind("domain", "instance").unwrap();
    s.save_draft("domain", "message", 0, "old").unwrap();
    let pages: i64 =
        s.db.query_row("PRAGMA page_count", [], |r| r.get(0))
            .unwrap();
    s.db.pragma_update(None, "max_page_count", pages).unwrap();
    assert!(s
        .save_draft("domain", "message", 1, &"x".repeat(200000))
        .is_err());
    assert_eq!(s.draft("domain", "message").unwrap()["text"], "old");
}
#[test]
fn stop_is_never_replayed_after_client_reopen() {
    let f = Fixture::new();
    let mut s = f.store("client");
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string()});
    s.enqueue(
        f.t.domain(),
        f.t.instance(),
        &Query::new("core/stop"),
        &body,
        None,
        true,
    )
    .unwrap();
    drop(s);
    let mut s = f.store("client");
    deliver(&f.t, &mut s).unwrap();
    assert_eq!(s.rows(f.t.domain()).unwrap()[0]["state"], "STOP_RECONFIRM");
    assert!(f.t.query(&Query::new("core")).is_ok());
}
#[test]
fn profile_config_and_bridge_snapshot_do_not_expose_token() {
    let f = Fixture::new();
    let root = f.tmp.path().join("desktop");
    discovery::private_dir(&root).unwrap();
    let config = json!([{"id":"test","data_dir":f.p.data_dir,"expected_mode":"fixture","node_abs":f.p.node_abs,"core_root":f.p.core_root,"backend_entry":f.p.backend_entry}]);
    let path = root.join("profiles.json");
    fs::write(&path, config.to_string()).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let mut b = Bridge::new(&root).unwrap();
    let snap = b.connect("test", false).unwrap();
    let e = discovery::endpoint(&f.p).unwrap();
    assert!(!snap.to_string().contains(&e.token));
    assert!(!snap.to_string().contains("node_abs"));
}
fn stop_core(f: &Fixture) {
    let _ = f.t.post(
        &Query::new("core/stop"),
        &json!({"request_id":uuid::Uuid::new_v4().to_string()}),
    );
    for _ in 0..100 {
        if !f.p.data_dir.join("core-endpoint.json").exists() {
            std::thread::sleep(std::time::Duration::from_millis(150));
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    panic!("stop timeout");
}
fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    fs::set_permissions(to, fs::Permissions::from_mode(0o700)).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &dest);
        } else {
            fs::copy(entry.path(), dest).unwrap();
        }
    }
}
#[test]
fn backup_fork_resync_preserves_accepted_evidence() {
    let mut f = Fixture::new();
    stop_core(&f);
    let backup = f.tmp.path().join("backup");
    copy_tree(&f.p.data_dir, &backup);
    f.t = Transport::start(&f.p).unwrap();
    let mut s = f.store("client");
    let mut sync = Synchronizer::default();
    sync.tick(&f.t, &mut s).unwrap();
    let body =
        json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"accepted before backup fork"});
    s.enqueue(
        f.t.domain(),
        f.t.instance(),
        &Query::new("messages"),
        &body,
        None,
        false,
    )
    .unwrap();
    deliver(&f.t, &mut s).unwrap();
    sync.tick(&f.t, &mut s).unwrap();
    let old = s.cursor(f.t.domain()).unwrap().unwrap();
    stop_core(&f);
    fs::remove_dir_all(&f.p.data_dir).unwrap();
    copy_tree(&backup, &f.p.data_dir);
    f.t = Transport::start(&f.p).unwrap();
    f.t.post(
        &Query::new("messages"),
        &json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"different fork"}),
    )
    .unwrap();
    let mut q = Query::new("sync/changes");
    q.parameters.insert("after".into(), json!(old));
    assert_eq!(f.t.query(&q).err().unwrap(), "RESYNC_REQUIRED");
    s.bind(f.t.domain(), f.t.instance()).unwrap();
    assert_eq!(sync.tick(&f.t, &mut s).err().unwrap(), "RESYNC_REQUIRED");
    sync.tick(&f.t, &mut s).unwrap();
    deliver(&f.t, &mut s).unwrap();
    assert_eq!(s.rows(f.t.domain()).unwrap()[0]["state"], "RECEIPT_MISSING");
    let mut q = Query::new("requests/{id}");
    q.id = Some(body["request_id"].as_str().unwrap().into());
    assert_eq!(f.t.query(&q).err().unwrap(), "NOT_FOUND");
}
#[test]
#[ignore = "subprocess crash worker invoked by parent"]
fn crash_child() {
    use std::io::{Read, Write};
    let dir = PathBuf::from(std::env::var("BRIDGE_CRASH_CORE").unwrap());
    let store = PathBuf::from(std::env::var("BRIDGE_CRASH_STORE").unwrap());
    let phase = std::env::var("BRIDGE_CRASH_PHASE").unwrap();
    let p = profile(&dir);
    let t = Transport::attach(&p).unwrap();
    let mut s = Storage::open(&store).unwrap();
    s.bind(t.domain(), t.instance()).unwrap();
    s.save_draft(t.domain(), "message", 0, "killed client")
        .unwrap();
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"killed client"});
    let id = s
        .enqueue(
            t.domain(),
            t.instance(),
            &Query::new("messages"),
            &body,
            Some(("message", 1)),
            false,
        )
        .unwrap();
    if phase != "enqueue" {
        s.mark(&id, "SENDING", None).unwrap();
        let receipt = t.post(&Query::new("messages"), &body).unwrap();
        if phase == "receipt" {
            s.mark(&id, "ACCEPTED", Some(&receipt)).unwrap();
        }
    }
    println!("CRASH_READY");
    std::io::stdout().flush().unwrap();
    let _ = std::io::stdin().read(&mut [0]);
}
#[test]
fn client_sigkill_at_durable_boundaries() {
    use std::io::{BufRead, BufReader};
    use std::process::Stdio;
    let f = Fixture::new();
    for phase in ["enqueue", "post", "receipt"] {
        let dir = f.tmp.path().join(phase);
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "crash_child", "--ignored", "--nocapture"])
            .env("BRIDGE_CRASH_CORE", &f.p.data_dir)
            .env("BRIDGE_CRASH_STORE", &dir)
            .env("BRIDGE_CRASH_PHASE", phase)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut reader = BufReader::new(child.stdout.take().unwrap());
        loop {
            let mut line = String::new();
            assert!(
                reader.read_line(&mut line).unwrap() > 0,
                "child exited before checkpoint"
            );
            if line.contains("CRASH_READY") {
                break;
            }
        }
        child.kill().unwrap();
        child.wait().unwrap();
        let mut s = Storage::open(&dir).unwrap();
        s.bind(f.t.domain(), f.t.instance()).unwrap();
        assert_eq!(s.draft(f.t.domain(), "message").unwrap()["text"], "");
        let id = s.rows(f.t.domain()).unwrap()[0]["id"].clone();
        deliver(&f.t, &mut s).unwrap();
        let rows = s.rows(f.t.domain()).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], id);
        assert_eq!(rows[0]["state"], "ACCEPTED");
    }
}
#[test]
fn real_sse_receives_change_and_transient() {
    let f = Fixture::new();
    let cursor = f.t.query(&Query::new("sync/cursor")).unwrap()["cursor"]
        .as_str()
        .unwrap()
        .to_string();
    let stream = secretary_desktop_spike::sync::Stream::open(f.t.clone(), cursor);
    f.t.post(
        &Query::new("messages"),
        &json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"real SSE"}),
    )
    .unwrap();
    let end = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let (mut change, mut transient) = (false, false);
    while std::time::Instant::now() < end {
        if let Ok(e) = stream
            .receiver
            .recv_timeout(std::time::Duration::from_millis(500))
        {
            change |= e["kind"] == "change";
            transient |= !stream.mailbox.lock().unwrap()["data"].is_null();
            if change && transient {
                break;
            }
        }
    }
    assert!(change && transient);
}
#[test]
fn core_sigkill_rotates_instance_and_resumes() {
    let mut f = Fixture::new();
    let mut s = f.store("client");
    let mut sync = Synchronizer::default();
    sync.tick(&f.t, &mut s).unwrap();
    let instance = f.t.instance().to_owned();
    let raw: Value =
        serde_json::from_slice(&fs::read(f.p.data_dir.join("core-endpoint.json")).unwrap())
            .unwrap();
    unsafe {
        libc::kill(raw["pid"].as_i64().unwrap() as i32, libc::SIGKILL);
    };
    std::thread::sleep(std::time::Duration::from_millis(300));
    f.t = Transport::start(&f.p).unwrap();
    assert_ne!(f.t.instance(), instance);
    s.bind(f.t.domain(), f.t.instance()).unwrap();
    sync.reset();
    sync.tick(&f.t, &mut s).unwrap();
}
#[test]
fn real_artifact_download_integrity_and_corruption() {
    let mut f = Fixture::new();
    stop_core(&f);
    let output = Command::new("node")
        .args(["--import", "tsx"])
        .arg(root().join("test_case/offline/issue59/seed-artifact.ts"))
        .arg(&f.p.data_dir)
        .current_dir(root())
        .env("SECRETARY_MODE", "fixture")
        .output()
        .unwrap();
    assert!(output.status.success(), "seed artifact failed");
    let artifact: Value = serde_json::from_slice(&output.stdout).unwrap();
    f.t = Transport::start(&f.p).unwrap();
    let mut bytes = vec![];
    f.t.download(artifact["id"].as_str().unwrap(), &mut bytes)
        .unwrap();
    assert_eq!(String::from_utf8(bytes).unwrap(), "download 中文 😀");
    fs::write(
        f.p.data_dir
            .join("objects")
            .join(artifact["hash"].as_str().unwrap()),
        "corrupt bytes",
    )
    .unwrap();
    assert!(f
        .t
        .download(artifact["id"].as_str().unwrap(), &mut vec![])
        .is_err());
}
#[test]
fn unknown_and_missing_receipts_never_replay_and_quotas_preserve_draft() {
    let f = Fixture::new();
    let mut s = f.store("client");
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"never replay"});
    let id = s
        .enqueue(
            f.t.domain(),
            f.t.instance(),
            &Query::new("messages"),
            &body,
            None,
            false,
        )
        .unwrap();
    s.mark(&id, "UNKNOWN", Some(&json!({"state":"UNKNOWN"})))
        .unwrap();
    deliver(&f.t, &mut s).unwrap();
    let mut q = Query::new("requests/{id}");
    q.id = Some(id);
    assert_eq!(f.t.query(&q).err().unwrap(), "NOT_FOUND");
    s.save_draft(f.t.domain(), "message", 0, "keep under quota failure")
        .unwrap();
    s.db.execute_batch("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<999) INSERT INTO outbox(id,domain,instance,query,body,state) SELECT 'quota-'||x,'quota','i','{}','{}','UNKNOWN' FROM n;").unwrap();
    let body =
        json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"keep under quota failure"});
    assert_eq!(
        s.enqueue(
            f.t.domain(),
            f.t.instance(),
            &Query::new("messages"),
            &body,
            Some(("message", 1)),
            false
        )
        .err()
        .unwrap(),
        "OUTBOX_QUOTA"
    );
    assert_eq!(
        s.draft(f.t.domain(), "message").unwrap()["text"],
        "keep under quota failure"
    );
}
#[test]
fn initial_snapshot_catchup_does_not_lose_concurrent_change() {
    let f = Fixture::new();
    let mut s = f.store("client");
    let cursor = f.t.query(&Query::new("sync/cursor")).unwrap()["cursor"]
        .as_str()
        .unwrap()
        .to_owned();
    let q = Query::new("timeline");
    let initial = f.t.query(&q).unwrap();
    f.t.post(&Query::new("messages"),&json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"after snapshot before catchup"})).unwrap();
    s.project(f.t.domain(), &cursor, &[(q, initial)], true)
        .unwrap();
    let mut sync = Synchronizer::default();
    sync.tick(&f.t, &mut s).unwrap();
    assert!(s
        .snapshot(f.t.domain())
        .unwrap()
        .to_string()
        .contains("after snapshot before catchup"));
}
#[test]
fn storage_migration_permissions_and_domain_isolation() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("db");
    let mut s = Storage::open(&dir).unwrap();
    s.bind("a", "1").unwrap();
    assert_eq!(s.bind("b", "2").err().unwrap(), "DATA_DOMAIN_CONFLICT");
    s.db.pragma_update(None, "user_version", 99).unwrap();
    drop(s);
    assert_eq!(
        Storage::open(&dir).err().map(|e| e.to_string()).unwrap(),
        "UNSUPPORTED_STORAGE_VERSION"
    );
    fs::set_permissions(dir.join("client.sqlite"), fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(
        Storage::open(&dir).err().map(|e| e.to_string()).unwrap(),
        "UNSAFE_STORAGE"
    );
}
#[test]
fn notifications_capability_and_expired_page_recover() {
    let f = Fixture::new();
    assert!(f.t.query(&Query::new("notifications")).is_ok());
    let mut s = f.store("client");
    let mut sync = Synchronizer::default();
    let mut q = Query::new("tasks");
    q.parameters.insert("cursor".into(), json!("stale-cursor"));
    sync.subscriptions = vec![q];
    assert_eq!(sync.tick(&f.t, &mut s).err().unwrap(), "CURSOR_EXPIRED");
    sync.tick(&f.t, &mut s).unwrap();
    assert!(s.cursor(f.t.domain()).unwrap().is_some());
}
#[test]
fn outbox_fifo_prioritizes_new_work_over_history() {
    let f = Fixture::new();
    let mut s = f.store("client");
    for _ in 0..12 {
        let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"history"});
        let id = s
            .enqueue(
                f.t.domain(),
                f.t.instance(),
                &Query::new("messages"),
                &body,
                None,
                false,
            )
            .unwrap();
        s.mark(&id, "VERIFY_ACCEPTED", Some(&json!({"state":"ACCEPTED"})))
            .unwrap();
    }
    let first = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    let second = "00000000-0000-4000-8000-000000000002";
    for (id, text) in [(first, "first submitted"), (second, "second submitted")] {
        s.enqueue(
            f.t.domain(),
            f.t.instance(),
            &Query::new("messages"),
            &json!({"request_id":id,"text":text}),
            None,
            false,
        )
        .unwrap();
    }
    s.db.execute("UPDATE outbox SET updated=1", []).unwrap();
    let pending = s.pending(f.t.domain()).unwrap();
    assert_eq!(pending[0]["id"], first);
    assert_eq!(pending[1]["id"], second);
    deliver(&f.t, &mut s).unwrap();
    let data = f.t.query(&Query::new("timeline")).unwrap();
    let items = data["items"].as_array().unwrap();
    let a = items
        .iter()
        .position(|x| x["text"] == "first submitted")
        .unwrap();
    let b = items
        .iter()
        .position(|x| x["text"] == "second submitted")
        .unwrap();
    assert!(a < b);
}
#[test]
fn rebuild_clears_unknown_sync_and_keeps_outbox() {
    let f = Fixture::new();
    let root = f.tmp.path().join("desktop");
    discovery::private_dir(&root).unwrap();
    let config = json!([{"id":"test","data_dir":f.p.data_dir,"expected_mode":"fixture","node_abs":f.p.node_abs,"core_root":f.p.core_root,"backend_entry":f.p.backend_entry}]);
    let path = root.join("profiles.json");
    fs::write(&path, config.to_string()).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let mut b = Bridge::new(&root).unwrap();
    b.connect("test", false).unwrap();
    b.submit(
        Query::new("messages"),
        json!({"text":"retain through recovery"}),
        None,
    )
    .unwrap();
    b.error = Some("UNSUPPORTED_SYNC".into());
    b.subscribe(vec![Query::new("timeline")]).unwrap();
    b.tick();
    assert!(b.error.is_none());
    let s = b.snapshot().unwrap();
    assert!(s["cursor"].is_string());
    assert_eq!(s["outbox"].as_array().unwrap().len(), 1);
}
#[test]
fn stream_boundary_and_delivery_claim() {
    let mut parser = Parser::default();
    let text = format!(
        "event: transient\ndata: {{\"previews\":\"{}\"}}\n\n",
        "x".repeat(256 * 1024 - 40)
    );
    assert_eq!(parser.feed(text.as_bytes()).unwrap().len(), 1);
    let tmp = tempfile::tempdir().unwrap();
    let a = Storage::open(&tmp.path().join("db")).unwrap();
    let b = Storage::open_shared(&tmp.path().join("db")).unwrap();
    let claim = a.claim_delivery().unwrap().unwrap();
    assert!(b.claim_delivery().unwrap().is_none());
    drop(claim);
    assert!(b.claim_delivery().unwrap().is_some());
}
#[test]
fn real_sse_survives_more_than_thirty_seconds() {
    let f = Fixture::new();
    let cursor = f.t.query(&Query::new("sync/cursor")).unwrap()["cursor"]
        .as_str()
        .unwrap()
        .to_owned();
    let stream = secretary_desktop_spike::sync::Stream::open(f.t.clone(), cursor);
    std::thread::sleep(std::time::Duration::from_secs(1));
    assert!(!stream.mailbox.lock().unwrap()["data"].is_null());
    let until = std::time::Instant::now() + std::time::Duration::from_secs(31);
    while std::time::Instant::now() < until {
        match stream
            .receiver
            .recv_timeout(std::time::Duration::from_secs(1))
        {
            Ok(_) => (),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => (),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                panic!("live consumer stream disconnected")
            }
        }
    }
    f.t.post(
        &Query::new("messages"),
        &json!({"request_id":uuid::Uuid::new_v4().to_string(),"text":"after heartbeat window"}),
    )
    .unwrap();
    assert_eq!(
        stream
            .receiver
            .recv_timeout(std::time::Duration::from_secs(3))
            .unwrap()["kind"],
        "change"
    );
}

#[test]
fn independent_writers_wait_before_reading_a_wal_snapshot() {
    use std::sync::mpsc::{channel, RecvTimeoutError};
    use std::time::Duration;
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("db");
    let mut primary = Storage::open(&dir).unwrap();
    primary.bind("domain", "instance").unwrap();
    for operation in 0..4 {
        let mut shared = Storage::open_shared(&dir).unwrap();
        // WAL permits readers while another connection holds the writer lock.
        // DEFERRED reads would pin a snapshot and then fail at write upgrade.
        let lock = primary
            .db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .unwrap();
        lock.execute("UPDATE domains SET cursor='held'", [])
            .unwrap();
        let (ready_tx, ready_rx) = channel();
        let (result_tx, result_rx) = channel();
        let worker = std::thread::spawn(move || {
            ready_tx.send(()).unwrap();
            let result = match operation {
                0 => shared
                    .save_draft("domain", "message", 0, "durable")
                    .map(|_| ()),
                1 => shared.project("domain", "new", &[], false),
                2 => shared
                    .enqueue(
                        "domain",
                        "instance",
                        &Query::new("messages"),
                        &json!({"request_id":"concurrent-message","text":"new"}),
                        None,
                        false,
                    )
                    .map(|_| ()),
                _ => shared.bind("domain", "instance"),
            };
            result_tx.send(result).unwrap();
        });
        ready_rx.recv().unwrap();
        assert_eq!(
            result_rx.recv_timeout(Duration::from_millis(100)),
            Err(RecvTimeoutError::Timeout),
            "writer must wait instead of failing snapshot upgrade"
        );
        lock.commit().unwrap();
        result_rx
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        worker.join().unwrap();
    }
    assert_eq!(
        primary.draft("domain", "message").unwrap()["text"],
        "durable"
    );
    assert_eq!(primary.rows("domain").unwrap().len(), 1);
}

#[test]
fn resolved_history_yields_capacity_without_losing_pending_intent() {
    let tmp = tempfile::tempdir().unwrap();
    let mut s = Storage::open(&tmp.path().join("db")).unwrap();
    s.bind("domain", "instance").unwrap();
    s.db.execute_batch("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000) INSERT INTO outbox(id,domain,instance,query,body,state) SELECT 'history-'||x,'domain','instance','{}','{}',CASE WHEN x=1 THEN 'PENDING' ELSE 'ACCEPTED' END FROM n").unwrap();
    s.save_draft("domain", "message", 0, "new").unwrap();
    s.enqueue(
        "domain",
        "instance",
        &Query::new("messages"),
        &json!({"request_id":"new-message","text":"new"}),
        Some(("message", 1)),
        false,
    )
    .unwrap();
    s.enqueue(
        "domain",
        "instance",
        &Query::new("core/stop"),
        &json!({"request_id":"explicit-stop"}),
        None,
        true,
    )
    .unwrap();
    let rows = s.rows("domain").unwrap();
    assert_eq!(rows.len(), 1000);
    assert!(rows.iter().any(|r| r["id"] == "history-1"));
    assert!(rows.iter().any(|r| r["id"] == "new-message"));
    assert!(rows.iter().any(|r| r["id"] == "explicit-stop"));
    assert!(!rows
        .iter()
        .any(|r| r["id"] == "history-2" || r["id"] == "history-3"));
    assert_eq!(s.draft("domain", "message").unwrap()["text"], "");
}

#[test]
fn real_tick_cadence_keeps_transient_alive() {
    let f = Fixture::new();
    let mut s = f.store("cadence");
    let mut sync = Synchronizer::default();
    sync.tick(&f.t, &mut s).unwrap();
    let mut epoch = None;
    for _ in 0..10 {
        std::thread::sleep(std::time::Duration::from_secs(1));
        sync.tick(&f.t, &mut s).unwrap();
        assert!(
            !sync.transient.is_null(),
            "preview lost at real consumer cadence"
        );
        let current = sync.mailbox.lock().unwrap()["epoch"].clone();
        if let Some(old) = &epoch {
            assert_eq!(old, &current, "unexpected reconnect");
        }
        epoch = Some(current);
    }
}

#[test]
fn durable_bursts_coalesce_without_interrupting_transient_at_real_tick_cadence() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use std::time::{Duration, Instant};
    let f = Fixture::new();
    let mut s = f.store("burst-cadence");
    let mut sync = Synchronizer::default();
    sync.tick(&f.t, &mut s).unwrap();
    let initial = s.cursor(f.t.domain()).unwrap().unwrap();
    let epoch = sync.mailbox.lock().unwrap()["epoch"].clone();
    let posted = Arc::new(AtomicUsize::new(0));
    let producer_count = posted.clone();
    let t = f.t.clone();
    let producer = std::thread::spawn(move || {
        let start = Instant::now();
        // At least four committed inputs/second alongside Core's 100ms
        // transient sampling; the consumer still only drains once/second.
        for n in 0..44 {
            t.post(
                &Query::new("clients"),
                &json!({
                    "request_id":uuid::Uuid::new_v4().to_string(),
                    "name":format!("burst cadence {n}")
                }),
            )
            .unwrap();
            producer_count.fetch_add(1, Ordering::Relaxed);
            std::thread::sleep(
                (start + Duration::from_millis((n + 1) * 250))
                    .saturating_duration_since(Instant::now()),
            );
        }
    });
    let started = Instant::now();
    let mut previous_version = 0;
    let mut committed = s.cursor(f.t.domain()).unwrap();
    for _ in 0..10 {
        std::thread::sleep(Duration::from_secs(1));
        // Receiving hints cannot commit the durable cursor independently.
        assert_eq!(
            s.cursor(f.t.domain()).unwrap(),
            committed,
            "SSE hints must not advance the applied cursor"
        );
        let mut arrivals = Query::new("sync/changes");
        arrivals.parameters.insert("after".into(), json!(committed));
        let incoming = f.t.query(&arrivals).unwrap();
        assert!(
            incoming["transactions"].as_array().unwrap().len() >= 3,
            "each consumer interval must contain at least three committed transactions"
        );
        sync.tick(&f.t, &mut s).unwrap();
        committed = s.cursor(f.t.domain()).unwrap();
        let mailbox = sync.mailbox.lock().unwrap().clone();
        assert_eq!(mailbox["epoch"], epoch, "durable burst caused reconnect");
        assert_eq!(mailbox["connected"], true);
        assert!(!mailbox["data"].is_null());
        assert!(
            !sync.transient.is_null(),
            "transient wiped during durable burst"
        );
        let version = mailbox["version"].as_str().unwrap().parse::<u64>().unwrap();
        assert!(version > previous_version, "transient did not evolve");
        previous_version = version;
    }
    assert!(started.elapsed() >= Duration::from_secs(10));
    producer.join().unwrap();
    assert_eq!(posted.load(Ordering::Relaxed), 44);
    f.t.post(
        &Query::new("messages"),
        &json!({
            "request_id":uuid::Uuid::new_v4().to_string(),
            "text":"burst cadence convergence"
        }),
    )
    .unwrap();
    sync.tick(&f.t, &mut s).unwrap();
    assert_ne!(s.cursor(f.t.domain()).unwrap().unwrap(), initial);
    let mut q = Query::new("sync/changes");
    q.parameters.insert("after".into(), json!(initial));
    let changes = f.t.query(&q).unwrap();
    assert!(
        changes["transactions"].as_array().unwrap().len() >= 30,
        "test must exercise at least three durable commits/second"
    );
    let cache = s.snapshot(f.t.domain()).unwrap();
    assert!(
        cache["cache"]
            .as_object()
            .unwrap()
            .values()
            .any(|v| v["items"]
                .as_array()
                .is_some_and(|items| items.iter().any(|i| i["text"]
                    .as_str()
                    .is_some_and(|text| text.contains("burst cadence convergence"))))),
        "authoritative catch-up must converge after hint coalescing"
    );
}

#[test]
fn malformed_stream_can_retry_but_unknown_sync_semantics_halt() {
    let f = Fixture::new();
    let mut s = f.store("stream-retry");
    let mut sync = Synchronizer::default();
    sync.tick(&f.t, &mut s).unwrap();
    let original = sync.mailbox.lock().unwrap()["epoch"].clone();
    // Model a completed stream parser failure, preserving its error evidence.
    sync.stream = None;
    sync.mailbox.lock().unwrap()["error"] = json!("INVALID_RESPONSE");
    sync.tick(&f.t, &mut s).unwrap();
    assert_ne!(sync.mailbox.lock().unwrap()["epoch"], original);
    sync.stream = None;
    sync.mailbox.lock().unwrap()["error"] = json!("UNSUPPORTED_SYNC");
    let before = s.cursor(f.t.domain()).unwrap();
    assert_eq!(sync.tick(&f.t, &mut s).unwrap_err(), "UNSUPPORTED_SYNC");
    assert!(sync.stream.is_none());
    assert_eq!(s.cursor(f.t.domain()).unwrap(), before);
}

#[test]
fn approval_intents_are_unique_until_resolved_across_connections() {
    let tmp = tempfile::tempdir().unwrap();
    let mut one = Storage::open(&tmp.path().join("client")).unwrap();
    one.bind("domain", "instance").unwrap();
    let mut two = Storage::open(&tmp.path().join("client")).unwrap();
    let mut q = Query::new("authorizations/{id}/decision");
    q.id = Some(uuid::Uuid::new_v4().to_string());
    let body = json!({"request_id":uuid::Uuid::new_v4().to_string(),"decision":"APPROVE"});
    one.enqueue("domain", "instance", &q, &body, None, false)
        .unwrap();
    let second = json!({"request_id":uuid::Uuid::new_v4().to_string(),"decision":"REJECT"});
    assert_eq!(
        two.enqueue("domain", "instance", &q, &second, None, false)
            .unwrap_err(),
        "APPROVAL_PENDING"
    );
    assert_eq!(one.rows("domain").unwrap().len(), 1);
}
