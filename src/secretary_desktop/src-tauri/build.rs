fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "study_mode",
            "study_ready",
            "study_metrics",
            "bridge_profiles",
            "bridge_transient",
            "bridge_connect",
            "bridge_draft",
            "bridge_submit",
            "bridge_query",
            "bridge_subscribe",
            "bridge_anchor",
            "bridge_stop",
            "bridge_download",
        ]),
    ))
    .expect("Tauri build failed");
}
