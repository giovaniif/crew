pub mod attention;
pub mod local;

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use url::Url;

use attention::Banner;
#[cfg(desktop)]
use attention::{Action, Entry};
use local::LocalServe;

#[cfg(desktop)]
const TRAY: &str = "crew";

pub const DEFAULT_URL: &str = "http://127.0.0.1:7420/";

#[derive(Debug, PartialEq)]
pub enum Start {
    Bundled,
    Remote(Url),
}

pub fn start_url(configured: Option<String>) -> Result<Url, url::ParseError> {
    match configured.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Url::parse(value),
        _ => Url::parse(DEFAULT_URL),
    }
}

pub fn start_page(mobile: bool, configured: Option<String>) -> Result<Start, url::ParseError> {
    if mobile {
        return Ok(Start::Bundled);
    }
    start_url(configured).map(Start::Remote)
}

struct Started {
    url: Option<Url>,
    auth: Option<serde_json::Value>,
    problem: Option<String>,
}

static WINDOWS: AtomicUsize = AtomicUsize::new(0);

fn configured_url() -> Option<String> {
    std::env::var("CREW_URL")
        .ok()
        .filter(|v| !v.trim().is_empty())
}

fn find_local_crew() -> Option<PathBuf> {
    let bundled = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|d| d.to_path_buf()));
    let path = std::env::var_os("PATH");
    local::find_crew(bundled.as_deref(), path.as_deref())
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

fn start_local(app: &AppHandle, slot: &Mutex<Option<LocalServe>>) -> Result<Started, String> {
    let crew = find_local_crew().ok_or("crew is not in the app bundle or on PATH")?;
    let port = local::free_port().map_err(|e| e.to_string())?;
    let mut serve = LocalServe::start(&crew, port).map_err(|e| e.to_string())?;
    let url = Url::parse(&local::base_url(port)).map_err(|e| e.to_string())?;
    if !serve.wait_ready(Duration::from_secs(20)) {
        serve.stop();
        return Ok(Started {
            url: None,
            auth: None,
            problem: Some("crew serve did not start. The crew daemon may be down.".to_string()),
        });
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
    Ok(Started {
        url: Some(url),
        auth,
        problem: None,
    })
}

fn open_window(app: &AppHandle, started: Started) -> tauri::Result<()> {
    let n = WINDOWS.fetch_add(1, Ordering::SeqCst);
    let label = if n == 0 {
        "main".to_string()
    } else {
        format!("main-{n}")
    };
    let url = match started.url {
        Some(url) => WebviewUrl::External(url),
        None => WebviewUrl::App("index.html".into()),
    };
    let window = WebviewWindowBuilder::new(app, &label, url);
    #[cfg(desktop)]
    let window = window
        .title("crew")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0);
    let mut window = window;
    if let Some(auth) = started.auth {
        window = window.initialization_script(format!("window.__CREW_DESKTOP_AUTH__ = {auth};"));
    }
    if let Some(problem) = started.problem {
        let problem = serde_json::Value::String(problem);
        window =
            window.initialization_script(format!("window.__CREW_DESKTOP_PROBLEM__ = {problem};"));
    }
    let old: Vec<_> = app.webview_windows().into_values().collect();
    window.build()?;
    for w in old {
        let _ = w.close();
    }
    Ok(())
}

fn fix_local(app: &AppHandle) -> Result<(), String> {
    let crew = find_local_crew().ok_or("crew is not in the app bundle or on PATH")?;
    local::fix_daemon(&crew)?;
    if configured_url().is_some() {
        return Ok(());
    }
    let slot = app.state::<Mutex<Option<LocalServe>>>();
    let mut current = slot.lock().unwrap().take();
    if let Some(serve) = current.as_mut() {
        if serve.alive() {
            *slot.lock().unwrap() = current;
            return Ok(());
        }
        let port = serve.port;
        serve.stop();
        let mut again = LocalServe::start(&crew, port).map_err(|e| e.to_string())?;
        let ready = again.wait_ready(Duration::from_secs(20));
        *slot.lock().unwrap() = Some(again);
        return if ready {
            Ok(())
        } else {
            Err("crew serve did not start".to_string())
        };
    }
    let started = start_local(app, &slot)?;
    if let Some(problem) = started.problem {
        return Err(problem);
    }
    if started.auth.is_none() {
        return Err("crew serve started, but pairing failed".to_string());
    }
    open_window(app, started).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fix_daemon(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || fix_local(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(desktop)]
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

#[cfg(desktop)]
fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<tauri::WebviewWindow<R>> {
    app.webview_windows().into_values().next()
}

#[cfg(desktop)]
fn on_menu<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match attention::action(id) {
        Some(Action::Quit) => app.exit(0),
        Some(Action::Show(hash)) => {
            if let Some(window) = main_window(app) {
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
    #[cfg(mobile)]
    let _ = (&app, &menu);
    #[cfg(desktop)]
    if let Some(tray) = app.tray_by_id(TRAY) {
        let built = build_menu(&app, &menu).map_err(|e| e.to_string())?;
        tray.set_menu(Some(built)).map_err(|e| e.to_string())?;
        let tip = match attention::badge(&menu) {
            Some(n) => format!("crew: {n} need you"),
            None => "crew".to_string(),
        };
        let _ = tray.set_tooltip(Some(tip));
    }
    #[cfg(desktop)]
    if let Some(window) = main_window(&app) {
        let _ = window.set_badge_count(attention::badge(&menu));
    }
    Ok(())
}

#[cfg(desktop)]
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
        .invoke_handler(tauri::generate_handler![
            crew_notify,
            crew_attention,
            fix_daemon
        ])
        .manage(Mutex::new(None::<LocalServe>))
        .setup(|app| {
            if start_page(cfg!(mobile), None) == Ok(Start::Bundled) {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .build()?;
                return Ok(());
            }
            let handle = app.handle().clone();
            let started = match configured_url() {
                Some(value) => Started {
                    url: Some(start_url(Some(value))?),
                    auth: None,
                    problem: None,
                },
                None => {
                    let slot = app.state::<Mutex<Option<LocalServe>>>();
                    start_local(&handle, &slot).unwrap_or_else(|err| Started {
                        url: None,
                        auth: None,
                        problem: Some(err),
                    })
                }
            };
            open_window(&handle, started)?;
            #[cfg(desktop)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mobile_opens_the_bundled_connect_page() {
        assert_eq!(
            start_page(true, Some("https://crew.example.ts.net/".into())),
            Ok(Start::Bundled)
        );
        assert_eq!(start_page(true, None), Ok(Start::Bundled));
    }

    #[test]
    fn desktop_opens_the_configured_url() {
        assert_eq!(
            start_page(false, Some("https://crew.example.ts.net/".into())),
            Ok(Start::Remote(
                Url::parse("https://crew.example.ts.net/").unwrap()
            ))
        );
        assert_eq!(
            start_page(false, None),
            Ok(Start::Remote(Url::parse(DEFAULT_URL).unwrap()))
        );
    }
}
