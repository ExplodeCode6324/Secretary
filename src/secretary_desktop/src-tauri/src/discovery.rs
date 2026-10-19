use crate::{err, Result};
use serde::Deserialize;
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Profile {
    pub id: String,
    pub data_dir: PathBuf,
    pub expected_mode: String,
    pub node_abs: PathBuf,
    pub core_root: PathBuf,
    pub backend_entry: PathBuf,
}
#[derive(Clone, Deserialize)]
pub struct Endpoint {
    pub api_version: String,
    pub url: String,
    pub token: String,
    pub instance_id: String,
    pub data_domain_id: String,
}
pub fn private_dir(path: &Path) -> Result<()> {
    if !path.exists() {
        fs::create_dir_all(path).map_err(|_| err("STORAGE_UNAVAILABLE"))?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| err("STORAGE_UNAVAILABLE"))?;
    }
    let m = fs::symlink_metadata(path).map_err(|_| err("UNSAFE_DIRECTORY"))?;
    if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o077 != 0 {
        return Err(err("UNSAFE_DIRECTORY"));
    }
    Ok(())
}
pub fn secure_read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let parent = path.parent().ok_or_else(|| err("UNSAFE_ENDPOINT"))?;
    let m = fs::symlink_metadata(parent).map_err(|_| err("ENDPOINT_MISSING"))?;
    if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o022 != 0 {
        return Err(err("UNSAFE_ENDPOINT"));
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|e| {
            err(if e.kind() == std::io::ErrorKind::NotFound {
                "ENDPOINT_MISSING"
            } else {
                "UNSAFE_ENDPOINT"
            })
        })?;
    let m = file.metadata().map_err(|_| err("UNSAFE_ENDPOINT"))?;
    if !m.is_file()
        || m.uid() != unsafe { libc::geteuid() }
        || m.mode() & 0o777 != 0o600
        || m.len() > limit
    {
        return Err(err("UNSAFE_ENDPOINT"));
    }
    let mut data = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|_| err("UNSAFE_ENDPOINT"))?;
    if data.len() as u64 > limit {
        return Err(err("UNSAFE_ENDPOINT"));
    }
    Ok(data)
}
pub fn profiles(path: &Path) -> Result<Vec<Profile>> {
    let list: Vec<Profile> = serde_json::from_slice(&secure_read(path, 16384).map_err(|e| {
        if e == "ENDPOINT_MISSING" {
            err("PROFILE_CONFIG_MISSING")
        } else {
            e
        }
    })?)
    .map_err(|_| err("INVALID_PROFILE"))?;
    if list.len() > 16 {
        return Err(err("INVALID_PROFILE"));
    }
    let mut seen = std::collections::HashSet::new();
    for p in &list {
        if p.id.is_empty()
            || p.id.len() > 64
            || !p.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || !seen.insert(&p.id)
            || !["fixture", "live"].contains(&p.expected_mode.as_str())
            || [&p.data_dir, &p.node_abs, &p.core_root, &p.backend_entry]
                .iter()
                .any(|p| !p.is_absolute())
        {
            return Err(err("INVALID_PROFILE"));
        }
    }
    Ok(list)
}
pub fn endpoint(p: &Profile) -> Result<Endpoint> {
    let e: Endpoint =
        serde_json::from_slice(&secure_read(&p.data_dir.join("core-endpoint.json"), 16384)?)
            .map_err(|_| err("INVALID_ENDPOINT"))?;
    let port = e
        .url
        .strip_prefix("http://127.0.0.1:")
        .and_then(|v| v.parse::<u16>().ok())
        .filter(|p| *p > 0);
    if e.api_version != "1"
        || port.is_none()
        || e.url != format!("http://127.0.0.1:{}", port.unwrap_or(0))
        || e.token.len() != 64
        || !e
            .token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || uuid::Uuid::parse_str(&e.instance_id).is_err()
        || uuid::Uuid::parse_str(&e.data_domain_id).is_err()
    {
        return Err(err("INVALID_ENDPOINT"));
    }
    Ok(e)
}
pub fn spawn(p: &Profile) -> Result<std::process::Child> {
    if p.expected_mode != "fixture" {
        return Err(err("LIVE_START_EXTERNALLY"));
    }
    if !p.data_dir.exists() {
        private_dir(&p.data_dir)?;
    }
    let m = fs::symlink_metadata(&p.data_dir).map_err(|_| err("UNSAFE_DIRECTORY"))?;
    if !m.is_dir() || m.uid() != unsafe { libc::geteuid() } || m.mode() & 0o022 != 0 {
        return Err(err("UNSAFE_DIRECTORY"));
    }
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(p.data_dir.join("core.log"))
        .map_err(|_| err("UNSAFE_LOG"))?;
    let m = log.metadata().map_err(|_| err("UNSAFE_LOG"))?;
    if !m.is_file() || m.uid() != unsafe { libc::geteuid() } {
        return Err(err("UNSAFE_LOG"));
    }
    log.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| err("UNSAFE_LOG"))?;
    let mut c = Command::new(&p.node_abs);
    c.args(["--import", "tsx"])
        .arg(&p.backend_entry)
        .current_dir(&p.core_root)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("SECRETARY_MODE", &p.expected_mode)
        .env("SECRETARY_DATA", &p.data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone().map_err(|_| err("UNSAFE_LOG"))?))
        .stderr(Stdio::from(log));
    // setsid detaches Core from the app's process group and terminal.
    unsafe {
        c.pre_exec(|| {
            if libc::setsid() < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    c.spawn().map_err(|_| err("CORE_START_FAILED"))
}
pub fn secure_file(path: &Path) -> Result<File> {
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| err("STORAGE_UNAVAILABLE"))
}
