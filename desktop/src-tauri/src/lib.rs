pub mod attention;
pub mod local;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use url::Url;

use attention::{Action, Banner, Entry};
use local::LocalServe;

const TRAY: &str = "crew";

pub const DEFAULT_URL: &str = "http://127.0.0.1:7420/";

pub fn start_url(configured: Option<String>) -> Result<Url, url::ParseError> {
    match configured.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Url::parse(value),
        _ => Url::parse(DEFAULT_URL),
    }
}

struct Started {
    url: Url,
    auth: Option<serde_json::Value>,
}

fn configured_url() -> Option<String> {
    std::env::var("CREW_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
}

fn stored_auth(file: &PathBuf) -> Option<serde_json::Value> {
    serde_json::from_slice(&std::fs::read(file).ok()?).ok()
}

fn save_auth(file: &PathBuf, auth: &serde_json::Value) {
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(file, auth.to_string());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(file, std::fs::Permissions::from_mode(0o600));
    }
}

fn start_local(app: &tauri::App, slot: &Mutex<Option<LocalServe>>) -> Result<Started, String> {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.to_path_buf()));
    let path = std::env::var_os("PATH");
    let crew = local::find_crew(bundled.as_deref(), path.as_deref())
        .ok_or("crew is not in the app bundle or on PATH")?;
    let port = local::free_port().map_err(|e| e.to_string())?;
    let mut serve = LocalServe::start(&crew, port).map_err(|e| e.to_string())?;
    let url = Url::parse(&local::base_url(port)).map_err(|e| e.to_string())?;
    if !serve.wait_ready(Duration::from_secs(20)) {
        *slot.lock().unwrap() = Some(serve);
        return Ok(Started { url, auth: None });
    }
    let file = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("auth.json");
    let auth = match stored_auth(&file).filter(|a| local::token_works(port, a)) {
        Some(auth) => Some(auth),
        None => match local::pair(&crew, port) {
            Ok(auth) => {
                save_auth(&file, &auth);
                Some(auth)
            }
            Err(err) => {
                eprintln!("crew-desktop: pairing failed: {err}");
                None
            }
        },
    };
    *slot.lock().unwrap() = Some(serve);
    Ok(Started { url, auth })
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, model: &attention::Menu) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    for entry in attention::entries(model) {
        match entry {
            Entry::Separator => menu.append(&PredefinedMenuItem::separator(app)?)?,
            Entry::Item { id, text, enabled } => {
                let id = if id.is_empty() {
                    format!("label:{text}")
                } else {
                    id
                };
                menu.append(&MenuItem::with_id(app, id, text, enabled, None::<&str>)?)?
            }
        }
    }
    Ok(menu)
}

fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match attention::action(id) {
        Some(Action::Quit) => app.exit(0),
        Some(Action::Show(hash)) => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
                if let Some(hash) = hash {
                    let _ = window.eval(format!(
                        "window.location.hash = {};",
                        serde_json::Value::String(hash)
                    ));
                }
            }
        }
        None => {}
    }
}

#[tauri::command]
fn crew_notify<R: Runtime>(app: AppHandle<R>, banner: Banner) {
    let mut builder = app
        .notification()
        .builder()
        .title(&banner.title)
        .body(&banner.body);
    if banner.sound {
        builder = builder.sound("default");
    }
    if let Err(err) = builder.show() {
        eprintln!("crew-desktop: notification for {} failed: {err}", banner.id);
    }
}

#[tauri::command]
fn crew_attention<R: Runtime>(app: AppHandle<R>, menu: attention::Menu) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY) {
        let built = build_menu(&app, &menu).map_err(|e| e.to_string())?;
        tray.set_menu(Some(built)).map_err(|e| e.to_string())?;
        let tip = match attention::badge(&menu) {
            Some(n) => format!("crew: {n} need you"),
            None => "crew".to_string(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count(attention::badge(&menu));
    }
    Ok(())
}

fn add_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = build_menu(app, &attention::Menu::default())?;
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("crew")
        .menu(&menu)
        .on_menu_event(|app, event| on_menu(app, event.id().as_ref()));
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![crew_notify, crew_attention])
        .manage(Mutex::new(None::<LocalServe>))
        .setup(|app| {
            let started = match configured_url() {
                Some(value) => Started {
                    url: start_url(Some(value))?,
                    auth: None,
                },
                None => {
                    let slot = app.state::<Mutex<Option<LocalServe>>>();
                    start_local(app, &slot).unwrap_or_else(|err| {
                        eprintln!("crew-desktop: {err}");
                        Started {
                            url: start_url(None).expect("the default URL is valid"),
                            auth: None,
                        }
                    })
                }
            };
            let mut window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::External(started.url))
                    .title("crew")
                    .inner_size(1280.0, 800.0)
                    .min_inner_size(900.0, 600.0);
            if let Some(auth) = started.auth {
                window =
                    window.initialization_script(format!("window.__CREW_DESKTOP_AUTH__ = {auth};"));
            }
            window.build()?;
            if let Err(err) = add_tray(app.handle()) {
                eprintln!("crew-desktop: no tray: {err}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the crew app failed to start");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(mut serve) = handle
                .state::<Mutex<Option<LocalServe>>>()
                .lock()
                .unwrap()
                .take()
            {
                serve.stop();
            }
        }
    });
}
