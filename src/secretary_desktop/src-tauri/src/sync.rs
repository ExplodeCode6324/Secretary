use crate::{err, protocol::Query, storage::Storage, transport::Transport, Result};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::{sync_channel, Receiver},
    Arc,
};
use std::time::{Duration, Instant};
pub struct Stream {
    pub receiver: Receiver<Value>,
    cancel: Arc<AtomicBool>,
}
impl Drop for Stream {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}
impl Stream {
    pub fn open(t: Transport, cursor: String) -> Self {
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
            let _ = runtime.block_on(async {
                let mut response =
                    tokio::time::timeout(Duration::from_secs(3), t.stream_async(&cursor))
                        .await
                        .map_err(|_| err("NETWORK_UNAVAILABLE"))??;
                let mut parser = Parser::default();
                let mut last = Instant::now();
                while !stop.load(Ordering::Relaxed) {
                    match tokio::time::timeout(Duration::from_millis(100), response.chunk()).await {
                        Ok(Ok(Some(bytes))) => {
                            last = Instant::now();
                            for value in parser.feed(&bytes)? {
                                sender
                                    .try_send(value)
                                    .map_err(|_| err("STREAM_BACKPRESSURE"))?;
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
        });
        Self { receiver, cancel }
    }
}
#[derive(Default)]
pub struct Parser {
    bytes: Vec<u8>,
}
impl Parser {
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Value>> {
        self.bytes.extend_from_slice(bytes);
        if self.bytes.len() > 256 * 1024 {
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
            ],
            stream: None,
            transient: Value::Null,
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
            self.status = e.clone();
            self.stream = None;
            self.transient = Value::Null;
        }
        result
    }
    fn apply(&mut self, t: &Transport, s: &mut Storage) -> Result<()> {
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
            self.stream = Some(Stream::open(t.clone(), after));
        }
        self.status = "SYNCED".into();
        Ok(())
    }
}
