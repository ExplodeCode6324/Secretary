use std::sync::atomic::{AtomicBool, Ordering};
static READY: AtomicBool = AtomicBool::new(false);
#[tauri::command]
fn study_mode() -> serde_json::Value {
    let scenario = match std::env::var("SECRETARY_STUDY_SCENARIO").as_deref() {
        Ok("load") => "load",
        Ok("stream") => "stream",
        Ok("load-baseline") => "load-baseline",
        Ok("stream-baseline") => "stream-baseline",
        _ => "",
    };
    serde_json::json!({
        "scenario": scenario,
        "measure": std::env::var("SECRETARY_STUDY_MEASURE").as_deref() == Ok("1")
    })
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
        .invoke_handler(tauri::generate_handler![
            study_mode,
            study_ready,
            study_metrics
        ])
        .run(tauri::generate_context!())
        .expect("desktop runtime failed");
}
