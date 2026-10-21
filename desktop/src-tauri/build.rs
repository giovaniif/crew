fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["crew_notify", "crew_attention"]),
        ),
    )
    .expect("the tauri build failed")
}
