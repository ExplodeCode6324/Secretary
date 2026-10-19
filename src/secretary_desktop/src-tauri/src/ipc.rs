use secretary_desktop_spike::{bridge::Bridge, err, protocol::Query, Result};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::Manager;
#[derive(Clone)]
pub struct Native(
    pub Arc<Mutex<Result<Bridge>>>,
    Arc<std::sync::atomic::AtomicBool>,
    Arc<Mutex<Option<(std::path::PathBuf, String)>>>,
);
struct DownloadPermit(Arc<std::sync::atomic::AtomicBool>);
impl Drop for DownloadPermit {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}
fn with<T>(state: &Native, f: impl FnOnce(&mut Bridge) -> Result<T>) -> Result<T> {
    let mut lock = state.0.lock().map_err(|_| err("BRIDGE_UNAVAILABLE"))?;
    let b = lock.as_mut().map_err(|e| e.clone())?;
    f(b)
}
fn domain(b: &Bridge, expected: &str) -> Result<()> {
    if b.transport.as_ref().map(|t| t.domain()) != Some(expected) {
        return Err(err("DATA_DOMAIN_CONFLICT"));
    }
    Ok(())
}
#[tauri::command]
pub async fn bridge_profiles(state: tauri::State<'_, Native>) -> Result<Value> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || with(&s, |b| b.snapshot()))
        .await
        .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
#[tauri::command]
pub async fn bridge_connect(
    state: tauri::State<'_, Native>,
    profile: String,
    start: bool,
) -> Result<Value> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        with(&s, |b| {
            *s.2.lock().map_err(|_| err("BRIDGE_UNAVAILABLE"))? = None;
            let result = b.connect(&profile, start)?;
            *s.2.lock().map_err(|_| err("BRIDGE_UNAVAILABLE"))? = Some(b.draft_context()?);
            Ok(result)
        })
    })
    .await
    .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
#[tauri::command]
pub async fn bridge_draft(
    state: tauri::State<'_, Native>,
    expected_domain: String,
    version: i64,
    text: String,
) -> Result<Value> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let context =
            s.2.lock()
                .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
                .clone()
                .ok_or_else(|| err("DISCONNECTED"))?;
        if context.1 != expected_domain {
            return Err(err("DATA_DOMAIN_CONFLICT"));
        }
        secretary_desktop_spike::storage::Storage::open_shared(&context.0)?
            .save_draft(&context.1, "message", version, &text)
    })
    .await
    .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
#[tauri::command]
pub async fn bridge_submit(
    state: tauri::State<'_, Native>,
    expected_domain: String,
    query: Query,
    body: Value,
    draft_version: Option<i64>,
) -> Result<String> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        with(&s, |b| {
            domain(b, &expected_domain)?;
            b.submit(query, body, draft_version)
        })
    })
    .await
    .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
#[tauri::command]
pub async fn bridge_query(
    state: tauri::State<'_, Native>,
    expected_domain: String,
    query: Query,
) -> Result<Value> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        with(&s, |b| {
            domain(b, &expected_domain)?;
            b.query(&query)
        })
    })
    .await
    .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
#[tauri::command]
pub async fn bridge_subscribe(
    state: tauri::State<'_, Native>,
    expected_domain: String,
    queries: Vec<Query>,
) -> Result<()> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        with(&s, |b| {
            domain(b, &expected_domain)?;
            b.subscribe(queries)
        })
    })
    .await
    .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
#[tauri::command]
pub async fn bridge_anchor(
    state: tauri::State<'_, Native>,
    expected_domain: String,
    value: String,
) -> Result<()> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        with(&s, |b| {
            domain(b, &expected_domain)?;
            b.anchor(&value)
        })
    })
    .await
    .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
#[tauri::command]
pub async fn bridge_stop(
    state: tauri::State<'_, Native>,
    expected_domain: String,
    expected_instance: String,
) -> Result<Value> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        with(&s, |b| {
            domain(b, &expected_domain)?;
            if b.transport.as_ref().map(|t| t.instance()) != Some(expected_instance.as_str()) {
                return Err(err("INSTANCE_CHANGED"));
            }
            b.stop()
        })
    })
    .await
    .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
#[tauri::command]
pub async fn bridge_download(
    state: tauri::State<'_, Native>,
    expected_domain: String,
    id: String,
) -> Result<String> {
    let s = state.inner().clone();
    if s.1
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::AcqRel,
            std::sync::atomic::Ordering::Acquire,
        )
        .is_err()
    {
        return Err(err("DOWNLOAD_BUSY"));
    }
    let permit = DownloadPermit(s.1.clone());
    // The save destination is granted by a native dialog, never supplied by JS.
    let target = rfd::AsyncFileDialog::new()
        .set_file_name("artifact")
        .save_file()
        .await;
    let Some(target) = target else {
        return Ok("CANCELLED".into());
    };
    let target = target.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let transport = with(&s, |b| {
            domain(b, &expected_domain)?;
            b.transport.clone().ok_or_else(|| err("DISCONNECTED"))
        })?;
        let temporary =
            target.with_file_name(format!(".secretary-download-{}", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = secretary_desktop_spike::discovery::secure_file(&temporary)?;
            transport.download(&id, &mut file)?;
            file.sync_all().map_err(|_| err("STORAGE_UNAVAILABLE"))?;
            std::fs::rename(&temporary, &target).map_err(|_| err("STORAGE_UNAVAILABLE"))?;
            Ok("SAVED".into())
        })();
        let _ = std::fs::remove_file(temporary);
        result
    })
    .await
    .map_err(|_| err("BRIDGE_UNAVAILABLE"))?
}
pub fn setup(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let root = app.path().app_data_dir()?;
    // Native-test can isolate its own config; production always uses app_data_dir.
    #[cfg(feature = "native-test")]
    let root = std::env::var_os("SECRETARY_DESKTOP_TEST_DATA")
        .map(std::path::PathBuf::from)
        .unwrap_or(root);
    let state = Native(
        Arc::new(Mutex::new(Bridge::new(&root))),
        Arc::new(std::sync::atomic::AtomicBool::new(false)),
        Arc::new(Mutex::new(None)),
    );
    app.manage(state.clone());
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let _ = with(&state, |b| {
            if b.transport.is_some() {
                b.tick();
            }
            Ok(())
        });
    });
    Ok(())
}
