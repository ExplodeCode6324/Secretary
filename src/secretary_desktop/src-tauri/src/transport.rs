use crate::{
    discovery::{self, Endpoint, Profile},
    err,
    protocol::{self, Query},
    Result,
};
use reqwest::blocking::{Client, Response};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::time::{Duration, Instant};
#[derive(Clone)]
pub struct Transport {
    endpoint: Endpoint,
    client: Client,
    pub core: Value,
}
impl Transport {
    pub fn attach(profile: &Profile) -> Result<Self> {
        let endpoint = discovery::endpoint(profile)?;
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| err("NETWORK_UNAVAILABLE"))?;
        let mut t = Self {
            endpoint,
            client,
            core: Value::Null,
        };
        let core = t.query(&Query::new("core"))?;
        if core["instance_id"] != t.endpoint.instance_id
            || core["data_domain_id"] != t.endpoint.data_domain_id
        {
            return Err(err("IDENTITY_MISMATCH"));
        }
        if core["mode"] != profile.expected_mode {
            return Err(err("CORE_MODE_MISMATCH"));
        }
        if core["capabilities"]["reliable_sync"]["state"] != "supported"
            || core["capabilities"]["reliable_sync"]["allowed"] != true
        {
            return Err(err("UNSUPPORTED_CAPABILITY"));
        }
        t.core = core;
        Ok(t)
    }
    pub fn start(p: &Profile) -> Result<Self> {
        match Self::attach(p) {
            Ok(t) => return Ok(t),
            Err(e) if e == "ENDPOINT_MISSING" || e == "NETWORK_UNAVAILABLE" => (),
            Err(e) => return Err(e),
        }
        let mut child = discovery::spawn(p)?;
        let until = Instant::now() + Duration::from_secs(15);
        loop {
            if let Ok(t) = Self::attach(p) {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(t);
            }
            if child
                .try_wait()
                .map_err(|_| err("CORE_START_FAILED"))?
                .is_some()
            {
                return Self::attach(p).map_err(|_| err("CORE_START_FAILED"));
            }
            if Instant::now() >= until {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Err(err("CORE_START_TIMEOUT"));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    pub fn domain(&self) -> &str {
        &self.endpoint.data_domain_id
    }
    pub fn instance(&self) -> &str {
        &self.endpoint.instance_id
    }
    fn request(&self, method: reqwest::Method, route: &str) -> reqwest::blocking::RequestBuilder {
        self.client
            .request(method, format!("{}/api/v1/{}", self.endpoint.url, route))
            .bearer_auth(&self.endpoint.token)
            .header("X-Secretary-API-Version", "1")
    }
    fn decode(response: Response) -> Result<Value> {
        let status = response.status();
        if status.is_server_error() {
            return Err(err("NETWORK_UNAVAILABLE"));
        }
        let mut bytes = Vec::new();
        response
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| err("NETWORK_UNAVAILABLE"))?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err(err("RESPONSE_TOO_LARGE"));
        }
        let envelope: Value =
            serde_json::from_slice(&bytes).map_err(|_| err("INVALID_RESPONSE"))?;
        if !status.is_success() {
            return Err(protocol::error_code(
                envelope["error"]["code"]
                    .as_str()
                    .unwrap_or("CORE_REQUEST_FAILED"),
            ));
        }
        if envelope["api_version"] != "1" {
            return Err(err("UNSUPPORTED_VERSION"));
        }
        Ok(envelope["data"].clone())
    }
    pub fn capability(&self, operation: &str) -> Result<()> {
        if self.core.is_null() {
            return Ok(());
        }
        let category = operation.split('/').next().unwrap_or("");
        let capability = match category {
            "sync" => "reliable_sync",
            "assistant" => "assistant_profile",
            "task-requests" | "executions" => "tasks",
            "operations" | "authorization-rules" => "authorizations",
            "session" => "messages",
            "clients" | "requests" => "core",
            "activities" => "timeline",
            other => other,
        };
        if self.core["capabilities"][capability]["state"] != "supported"
            || self.core["capabilities"][capability]["allowed"] != true
        {
            return Err(err("UNSUPPORTED_CAPABILITY"));
        }
        Ok(())
    }
    pub fn query(&self, q: &Query) -> Result<Value> {
        self.capability(&q.operation)?;
        let route = protocol::route("GET", q)?;
        let op = protocol::operation("GET", &q.operation)?;
        if op["response"] == "binary" || op["media_type"] == "text/event-stream" {
            return Err(err("UNSUPPORTED_OPERATION"));
        }
        let data = Self::decode(
            self.request(reqwest::Method::GET, &route)
                .send()
                .map_err(|_| err("NETWORK_UNAVAILABLE"))?,
        )?;
        protocol::validate(op["response"].as_str().unwrap_or(""), &data, true)?;
        Ok(data)
    }
    pub fn post(&self, q: &Query, body: &Value) -> Result<Value> {
        self.capability(&q.operation)?;
        let route = protocol::command(q, body)?;
        let data = Self::decode(
            self.request(reqwest::Method::POST, &route)
                .json(body)
                .send()
                .map_err(|_| err("NETWORK_UNAVAILABLE"))?,
        )?;
        protocol::validate("Receipt", &data, true)?;
        if data["request_id"] != body["request_id"] {
            return Err(err("INVALID_RESPONSE"));
        }
        Ok(data)
    }
    pub async fn stream_async(&self, after: &str) -> Result<reqwest::Response> {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .build()
            .map_err(|_| err("NETWORK_UNAVAILABLE"))?;
        let response = client
            .get(format!("{}/api/v1/sync/stream", self.endpoint.url))
            .bearer_auth(&self.endpoint.token)
            .header("X-Secretary-API-Version", "1")
            .header("Last-Event-ID", after)
            .send()
            .await
            .map_err(|_| err("NETWORK_UNAVAILABLE"))?;
        if !response.status().is_success() {
            return Err(err("STREAM_UNAVAILABLE"));
        }
        Ok(response)
    }
    pub fn download(&self, id: &str, mut out: impl Write) -> Result<()> {
        let mut q = Query::new("artifacts/{id}");
        q.id = Some(id.into());
        let artifact = self.query(&q)?;
        let bytes = artifact["bytes"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            .ok_or_else(|| err("ARTIFACT_UNAVAILABLE"))?;
        if bytes > 256 * 1024 * 1024 {
            return Err(err("DOWNLOAD_QUOTA"));
        }
        let hash = artifact["content_version"]
            .as_str()
            .ok_or_else(|| err("ARTIFACT_UNAVAILABLE"))?;
        let mut r = self
            .request(reqwest::Method::GET, &format!("artifacts/{id}/content"))
            .timeout(Duration::from_secs(120))
            .send()
            .map_err(|_| err("NETWORK_UNAVAILABLE"))?;
        if !r.status().is_success() {
            Self::decode(r)?;
            return Err(err("ARTIFACT_UNAVAILABLE"));
        }
        let mut h = Sha256::new();
        let mut total = 0;
        let mut b = [0; 32768];
        loop {
            let n = r.read(&mut b).map_err(|_| err("NETWORK_UNAVAILABLE"))?;
            if n == 0 {
                break;
            }
            total += n as u64;
            if total > bytes {
                return Err(err("ARTIFACT_INTEGRITY"));
            }
            h.update(&b[..n]);
            out.write_all(&b[..n])
                .map_err(|_| err("STORAGE_UNAVAILABLE"))?;
        }
        if total != bytes || format!("{:x}", h.finalize()) != hash {
            return Err(err("ARTIFACT_INTEGRITY"));
        }
        Ok(())
    }
}
