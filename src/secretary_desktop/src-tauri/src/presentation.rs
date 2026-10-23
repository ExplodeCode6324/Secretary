//! Narrow user-activated presentation actions. No shell, file paths, or clipboard reads.
use crate::{err, Result};
pub fn external_url(value: &str) -> Result<reqwest::Url> {
    if value.len() > 2048 || value.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(err("INVALID_URL"));
    }
    let lower = value.to_ascii_lowercase();
    if ["%00", "%0a", "%0d", "%09", "%7f"]
        .iter()
        .any(|s| lower.contains(s))
    {
        return Err(err("INVALID_URL"));
    }
    let url = reqwest::Url::parse(value).map_err(|_| err("INVALID_URL"))?;
    if !["https", "http"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(err("INVALID_URL"));
    }
    Ok(url)
}
#[cfg(target_os = "macos")]
pub fn copy_text(text: String) -> Result<()> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    if text.len() > 2 * 1024 * 1024 {
        return Err(err("COPY_LIMIT"));
    }
    let mut child = Command::new("/usr/bin/pbcopy")
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| err("COPY_FAILED"))?;
    let mut stdin = child.stdin.take().ok_or_else(|| err("COPY_FAILED"))?;
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = stdin.write_all(text.as_bytes());
        drop(stdin);
        let _ = sender.send(result);
    });
    let start = Instant::now();
    let result = (|| {
        receiver
            .recv_timeout(Duration::from_secs(2))
            .map_err(|_| err("COPY_TIMEOUT"))?
            .map_err(|_| err("COPY_FAILED"))?;
        loop {
            if let Some(status) = child.try_wait().map_err(|_| err("COPY_FAILED"))? {
                return if status.success() {
                    Ok(())
                } else {
                    Err(err("COPY_FAILED"))
                };
            }
            if start.elapsed() >= Duration::from_secs(2) {
                return Err(err("COPY_TIMEOUT"));
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    })();
    if result.is_err() {
        let _ = child.kill();
        let _ = child.wait();
    }
    result
}
#[cfg(target_os = "macos")]
pub fn open_url(value: &str) -> Result<String> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};
    let url = external_url(value)?;
    let mut child = Command::new("/usr/bin/open")
        .arg(url.as_str())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| err("OPEN_FAILED"))?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|_| err("OPEN_FAILED"))? {
            return if status.success() {
                Ok("REQUESTED".into())
            } else {
                Err(err("OPEN_FAILED"))
            };
        }
        if start.elapsed() >= Duration::from_secs(2) {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            return Ok("REQUESTED_UNCONFIRMED".into());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[cfg(not(target_os = "macos"))]
pub fn copy_text(_: String) -> Result<()> {
    Err(err("UNSUPPORTED_PLATFORM"))
}
#[cfg(not(target_os = "macos"))]
pub fn open_url(_: &str) -> Result<String> {
    Err(err("UNSUPPORTED_PLATFORM"))
}
