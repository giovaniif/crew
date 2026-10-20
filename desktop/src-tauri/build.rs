fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["crew_notify", "crew_attention", "fix_daemon"]),
        ),
    )
    .expect("the tauri build failed")
}
