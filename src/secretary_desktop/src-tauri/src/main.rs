mod ipc;
mod launch;
use std::sync::atomic::{AtomicBool, Ordering};
static READY: AtomicBool = AtomicBool::new(false);
#[tauri::command]
fn study_mode() -> Result<launch::Launch, String> {
    launch::current()
}
#[tauri::command]
async fn phaseui_view(
    window: tauri::WebviewWindow,
    width: f64,
    zoom: f64,
    height: Option<f64>,
) -> Result<(), String> {
    if launch::current()?.phase.is_empty() {
        return Err("DIAGNOSTIC_ONLY".into());
    }
    let height = height.unwrap_or(820.0);
    if !(480.0..=1400.0).contains(&height)
        || !(480.0..=1800.0).contains(&width)
        || ![1.0, 1.25, 1.5, 2.0].contains(&zoom)
    {
        return Err("INVALID_VIEW".into());
    }
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    window.set_zoom(zoom).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
fn study_ready() {
    if !READY.swap(true, Ordering::Relaxed) {
        println!("STUDY_READY");
    }
}
#[tauri::command]
fn study_metrics(report: String) {
    if std::env::var("SECRETARY_STUDY_MEASURE").as_deref() == Ok("1") && report.len() <= 4096 {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&report) {
            println!("STUDY_METRICS {}", value);
        }
    }
}
fn main() {
    let builder = tauri::Builder::default();
    #[cfg(feature = "native-test")]
    let builder = builder
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_wdio_webdriver::init());
    builder
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("navigation-boundary")
                .on_navigation(|_, url| {
                    // Config-created window also passes through this plugin hook.
                    #[cfg(debug_assertions)]
                    if url.origin().ascii_serialization() == "http://127.0.0.1:1420" {
                        return true;
                    }
                    url.scheme() == "tauri" && url.host_str() == Some("localhost")
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            study_mode,
            phaseui_view,
            study_ready,
            study_metrics,
            ipc::bridge_profiles,
            ipc::bridge_transient,
            ipc::bridge_connect,
            ipc::bridge_draft,
            ipc::bridge_submit,
            ipc::bridge_query,
            ipc::bridge_subscribe,
            ipc::bridge_anchor,
            ipc::bridge_stop,
            ipc::bridge_download,
            ipc::bridge_copy_text,
            ipc::bridge_open_url,
            ipc::bridge_message_outbox,
            ipc::bridge_message_body,
            ipc::bridge_discard_message,
        ])
        .setup(ipc::setup)
        .run(tauri::generate_context!())
        .expect("desktop runtime failed");
}
