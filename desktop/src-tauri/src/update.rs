use std::time::Duration;

pub const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, PartialEq)]
pub enum Step {
    Install,
    StopServe,
    StopDaemon,
    Restart,
}

#[derive(Debug, PartialEq)]
pub struct Prompt {
    pub title: String,
    pub message: String,
    pub install: String,
    pub later: String,
}

fn parse(version: &str) -> Option<semver::Version> {
    let version = version.trim();
    semver::Version::parse(version.strip_prefix('v').unwrap_or(version)).ok()
}

pub fn newer(current: &str, candidate: &str) -> bool {
    match (parse(current), parse(candidate)) {
        (Some(current), Some(candidate)) => candidate > current,
        _ => false,
    }
}

pub fn prompt(current: &str, latest: &str, notes: Option<&str>) -> Prompt {
    let mut message = format!(
        "You have crew {current}. Install crew {latest} now? The update replaces the app and its crew binary. Then crew stops the crew daemon and restarts the app, so that the new crew starts a new daemon."
    );
    if let Some(notes) = notes.map(str::trim).filter(|n| !n.is_empty()) {
        message.push_str("\n\n");
        message.push_str(notes);
    }
    Prompt {
        title: format!("crew {latest} is available"),
        message,
        install: "Install and restart".into(),
        later: "Later".into(),
    }
}

pub fn answer(agreed: bool) -> Vec<Step> {
    if !agreed {
        return Vec::new();
    }
    vec![
        Step::Install,
        Step::StopServe,
        Step::StopDaemon,
        Step::Restart,
    ]
}

#[cfg(desktop)]
pub fn off() -> bool {
    cfg!(debug_assertions)
        || std::env::var("CREW_NO_UPDATE_CHECK").is_ok_and(|v| !v.trim().is_empty())
}

#[cfg(desktop)]
pub fn watch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    crew: Option<std::path::PathBuf>,
    stop_serve: impl Fn(&tauri::AppHandle<R>) + Send + 'static,
) {
    std::thread::spawn(move || loop {
        let checked =
            tauri::async_runtime::block_on(check(&app, crew.as_deref(), &stop_serve)).map(|_| ());
        if let Err(err) = checked {
            eprintln!("crew-desktop: update check failed: {err}");
        }
        std::thread::sleep(CHECK_EVERY);
    });
}

#[cfg(desktop)]
pub async fn check<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    crew: Option<&std::path::Path>,
    stop_serve: &impl Fn(&tauri::AppHandle<R>),
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    use tauri_plugin_updater::UpdaterExt;

    let current = app.package_info().version.to_string();
    let updater = app
        .updater_builder()
        .version_comparator(|current, release| {
            newer(&current.to_string(), &release.version.to_string())
        })
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let latest = update.version.clone();
    let text = prompt(&current, &update.version, update.body.as_deref());
    let agreed = app
        .dialog()
        .message(text.message)
        .title(text.title)
        .buttons(MessageDialogButtons::OkCancelCustom(
            text.install,
            text.later,
        ))
        .blocking_show();
    for step in answer(agreed) {
        match step {
            Step::Install => update
                .download_and_install(|_, _| {}, || {})
                .await
                .map_err(|e| e.to_string())?,
            Step::StopServe => stop_serve(app),
            Step::StopDaemon => {
                if let Some(crew) = crew {
                    let stopped = std::process::Command::new(crew)
                        .args(["daemon", "stop"])
                        .status();
                    if let Err(err) = stopped {
                        eprintln!("crew-desktop: crew daemon stop failed: {err}");
                    }
                }
            }
            Step::Restart => app.restart(),
        }
    }
    Ok(Some(latest))
}
