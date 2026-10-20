use crate::{err, protocol::Query, storage::Storage, transport::Transport, Result};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{sync_channel, Receiver, TrySendError},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
pub type Mailbox = Arc<Mutex<Value>>;
pub struct Stream {
    pub mailbox: Mailbox,
    epoch: String,
    pub receiver: Receiver<Value>,
    cancel: Arc<AtomicBool>,
}
impl Drop for Stream {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        if let Ok(mut m) = self.mailbox.lock() {
            if m["epoch"] == self.epoch {
                m["connected"] = Value::Bool(false);
                m["data"] = Value::Null;
            }
        }
    }
}
impl Stream {
    pub fn open(t: Transport, cursor: String) -> Self {
        Self::with_mailbox(t, cursor, Arc::new(Mutex::new(Value::Null)))
    }
    pub fn with_mailbox(t: Transport, cursor: String, mailbox: Mailbox) -> Self {
        let epoch = uuid::Uuid::new_v4().to_string();
        *mailbox.lock().expect("mailbox") = serde_json::json!({"domain":t.domain(),"instance":t.instance(),"epoch":epoch,"version":"0","connected":false,"data":null});
        let published = mailbox.clone();
        let generation = epoch.clone();
        let (sender, receiver) = sync_channel(2);
        let cancel = Arc::new(AtomicBool::new(false));
        let stop = cancel.clone();
        std::thread::spawn(move || {
            let Ok(runtime) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            else {
                return;
            };
            let result = runtime.block_on(async {
                let mut response =
                    tokio::time::timeout(Duration::from_secs(3), t.stream_async(&cursor))
                        .await
                        .map_err(|_| err("NETWORK_UNAVAILABLE"))??;
                let mut version = 0u64;
                let mut parser = Parser::default();
                let mut last = Instant::now();
                while !stop.load(Ordering::Relaxed) {
                    match tokio::time::timeout(Duration::from_millis(100), response.chunk()).await {
                        Ok(Ok(Some(bytes))) => {
                            last = Instant::now();
                            for value in parser.feed(&bytes)? {
                                if value["kind"] == "transient" {
                                    version += 1;
                                    let mut m =
                                        published.lock().map_err(|_| err("BRIDGE_UNAVAILABLE"))?;
                                    if m["epoch"] != generation {
                                        return Ok(());
                                    }
                                    m["version"] = Value::String(version.to_string());
                                    m["connected"] = Value::Bool(true);
                                    m["data"] = value["data"].clone();
                                } else {
                                    // Parsed durable frames are only wake hints: the
                                    // authoritative transaction/cursor comes from
                                    // sync/changes. A queued hint already covers
                                    // another validated change, so coalesce bursts.
                                    match sender.try_send(value) {
                                        Ok(()) | Err(TrySendError::Full(_)) => (),
                                        Err(TrySendError::Disconnected(_)) => return Ok(()),
                                    }
                                }
                            }
                        }
                        Ok(Ok(None)) => break,
                        Ok(Err(_)) => return Err(err("NETWORK_UNAVAILABLE")),
                        Err(_) => {
                            if last.elapsed() > Duration::from_secs(12) {
                                return Err(err("STREAM_TIMEOUT"));
                            }
                        }
                    }
                }
                Ok(()) as Result<()>
            });
            if let Ok(mut m) = published.lock() {
                if m["epoch"] == generation {
                    m["connected"] = Value::Bool(false);
                    m["data"] = Value::Null;
                    if let Err(error) = result {
                        m["error"] = Value::String(error);
                    }
                }
            }
        });
        Self {
            receiver,
            cancel,
            mailbox,
            epoch,
        }
    }
}
#[derive(Default)]
pub struct Parser {
    bytes: Vec<u8>,
}
impl Parser {
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Value>> {
        self.bytes.extend_from_slice(bytes);
        if self.bytes.len() > 256 * 1024 + 16384 {
            return Err(err("STREAM_BACKPRESSURE"));
        }
        let mut events = Vec::new();
        while let Some(n) = self.bytes.windows(2).position(|b| b == b"\n\n") {
            let frame: Vec<u8> = self.bytes.drain(..n + 2).collect();
            let text = std::str::from_utf8(&frame).map_err(|_| err("INVALID_RESPONSE"))?;
            let mut kind = "";
            let mut data = String::new();
            let mut id = None;
            for line in text.lines() {
                if let Some(v) = line.strip_prefix("event: ") {
                    kind = v;
                } else if let Some(v) = line.strip_prefix("data: ") {
                    data.push_str(v);
                } else if let Some(v) = line.strip_prefix("id: ") {
                    id = Some(v);
                }
            }
            if kind.is_empty() {
                continue;
            }
            let value: Value = serde_json::from_str(&data).map_err(|_| err("INVALID_RESPONSE"))?;
            if kind == "change" {
                if id != value["cursor"].as_str() {
                    return Err(err("INVALID_RESPONSE"));
                }
                validate_changes(&value)?;
            } else if kind != "transient" || id.is_some() {
                return Err(err("UNSUPPORTED_SYNC"));
            }
            events.push(serde_json::json!({"kind":kind,"data":value}));
        }
        Ok(events)
    }
}
pub fn validate_changes(tx: &Value) -> Result<()> {
    if tx["cursor"].as_str().is_none() {
        return Err(err("INVALID_RESPONSE"));
    }
    for change in tx["changes"]
        .as_array()
        .ok_or_else(|| err("INVALID_RESPONSE"))?
    {
        if ![Some("record"), Some("invalidate")].contains(&change["kind"].as_str()) {
            return Err(err("UNSUPPORTED_SYNC"));
        }
    }
    Ok(())
}
pub struct Synchronizer {
    pub subscriptions: Vec<Query>,
    pub stream: Option<Stream>,
    pub transient: Value,
    pub mailbox: Mailbox,
    pub status: String,
    next_stream: Instant,
    failures: u32,
    refresh: bool,
}
impl Default for Synchronizer {
    fn default() -> Self {
        Self {
            subscriptions: vec![
                Query::new("assistant"),
                Query::new("timeline"),
                Query::new("attention"),
                Query::new("tasks"),
            ],
            stream: None,
            transient: Value::Null,
            mailbox: Arc::new(Mutex::new(Value::Null)),
            status: "DISCONNECTED".into(),
            next_stream: Instant::now(),
            failures: 0,
            refresh: true,
        }
    }
}
impl Synchronizer {
    pub fn disconnect(&mut self) {
        self.stream = None;
        self.transient = Value::Null;
        *self.mailbox.lock().expect("mailbox") = Value::Null;
        self.status = "DISCONNECTED".into();
    }
    pub fn reset(&mut self) {
        self.disconnect();
        self.next_stream = Instant::now();
        self.failures = 0;
        self.refresh = true;
    }
    fn fetch(&self, t: &Transport) -> Result<Vec<(Query, Value)>> {
        self.subscriptions
            .iter()
            .map(|q| Ok((q.clone(), t.query(q)?)))
            .collect()
    }
    pub fn tick(&mut self, t: &Transport, s: &mut Storage) -> Result<()> {
        let result = self.apply(t, s);
        if let Err(e) = &result {
            if e == "CURSOR_EXPIRED" {
                for query in &mut self.subscriptions {
                    query.parameters.remove("cursor");
                }
                s.clear_cache(t.domain())?;
                self.refresh = true;
            }
            self.status = e.clone();
            self.stream = None;
            self.transient = Value::Null;
        }
        result
    }
    fn apply(&mut self, t: &Transport, s: &mut Storage) -> Result<()> {
        let failure = self.mailbox.lock().map_err(|_| err("BRIDGE_UNAVAILABLE"))?["error"]
            .as_str()
            .map(str::to_owned);
        if let Some(error) = failure {
            if [
                "UNSUPPORTED_SYNC",
                "AUTH_REQUIRED",
                "DATA_DOMAIN_CONFLICT",
                "INSTANCE_CHANGED",
            ]
            .contains(&error.as_str())
            {
                return Err(error);
            }
        }
        let domain = t.domain();
        let mut cursor = s.cursor(domain)?;
        if cursor.is_none() {
            let start = t.query(&Query::new("sync/cursor"))?;
            let at = start["cursor"]
                .as_str()
                .ok_or_else(|| err("INVALID_RESPONSE"))?;
            let values = self.fetch(t)?;
            s.project(domain, at, &values, true)?;
            cursor = Some(at.into());
        }
        let mut after = cursor.expect("initialized");
        if self.refresh {
            let values = self.fetch(t)?;
            s.project(domain, &after, &values, true)?;
            self.refresh = false;
        }
        // Bounded work per tick. No concurrent writers: refresh and cursor commit
        // share the same serialized bridge lock, so an older generation cannot win.
        for _ in 0..4 {
            let mut q = Query::new("sync/changes");
            q.parameters
                .insert("after".into(), Value::String(after.clone()));
            let page = match t.query(&q) {
                Err(e) if e == "RESYNC_REQUIRED" => {
                    s.clear_cache(domain)?;
                    self.reset();
                    return Err(e);
                }
                other => other?,
            };
            let txs = page["transactions"]
                .as_array()
                .ok_or_else(|| err("INVALID_RESPONSE"))?;
            for tx in txs {
                validate_changes(tx)?;
            }
            let next = page["next_cursor"]
                .as_str()
                .ok_or_else(|| err("INVALID_RESPONSE"))?;
            // Refresh every bounded subscribed window on any invalidation. This
            // includes aggregates whose root revision did not change.
            let changed = txs
                .iter()
                .any(|tx| tx["changes"].as_array().is_some_and(|x| !x.is_empty()));
            let values = if changed { self.fetch(t)? } else { vec![] };
            s.project(domain, next, &values, false)?;
            after = next.into();
            if page["has_more"] != true {
                break;
            }
        }
        if let Some(stream) = &self.stream {
            loop {
                match stream.receiver.try_recv() {
                    Ok(event) => {
                        self.failures = 0;
                        if event["kind"] == "transient" {
                            self.transient = event["data"].clone();
                        }
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => break,
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        self.stream = None;
                        self.transient = Value::Null;
                        self.failures = (self.failures + 1).min(5);
                        self.next_stream = Instant::now()
                            + Duration::from_millis(
                                (1 << self.failures) * 100
                                    + u64::from(uuid::Uuid::new_v4().as_bytes()[0]),
                            );
                        break;
                    }
                }
            }
        }
        if self.stream.is_none() && Instant::now() >= self.next_stream {
            self.stream = Some(Stream::with_mailbox(t.clone(), after, self.mailbox.clone()));
        }
        self.transient =
            self.mailbox.lock().map_err(|_| err("BRIDGE_UNAVAILABLE"))?["data"].clone();
        self.status = "SYNCED".into();
        Ok(())
    }
}
