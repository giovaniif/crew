pub mod local;

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use local::LocalServe;

pub const DEFAULT_URL: &str = "http://127.0.0.1:7420/";

pub fn start_url(configured: Option<String>) -> Result<Url, url::ParseError> {
    match configured.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Url::parse(value),
        _ => Url::parse(DEFAULT_URL),
    }
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
        None if app.asset_resolver().get("app.html".into()).is_some() => {
            WebviewUrl::App("app.html".into())
        }
        None => WebviewUrl::App("index.html".into()),
    };
    let mut window = WebviewWindowBuilder::new(app, &label, url)
        .title("crew")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(Mutex::new(None::<LocalServe>))
        .invoke_handler(tauri::generate_handler![fix_daemon])
        .setup(|app| {
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
