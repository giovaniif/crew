fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "crew_notify",
            "crew_attention",
            "fix_daemon",
            "crew_servers",
            "crew_ssh_hosts",
            "crew_server_add",
            "crew_server_open",
            "crew_server_remove",
            "crew_server_fix",
            "crew_server_crew",
            "crew_server_install",
            "crew_server_workspace",
            "crew_browser_open",
            "crew_pick_folder",
            "crew_check_update",
        ])),
    )
    .expect("the tauri build failed")
}
