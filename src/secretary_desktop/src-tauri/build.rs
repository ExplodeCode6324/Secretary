fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["study_mode", "study_ready", "study_metrics"]),
    ))
    .expect("Tauri build failed");
}
