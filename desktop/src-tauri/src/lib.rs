pub mod local;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use url::Url;

use local::LocalServe;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(Mutex::new(None::<LocalServe>))
        .setup(|app| {
            if start_page(cfg!(mobile), None) == Ok(Start::Bundled) {
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into())).build()?;
                return Ok(());
            }
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
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(started.url));
            #[cfg(desktop)]
            let window = window
                .title("crew")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0);
            let mut window = window;
            if let Some(auth) = started.auth {
                window =
                    window.initialization_script(format!("window.__CREW_DESKTOP_AUTH__ = {auth};"));
            }
            window.build()?;
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
        assert_eq!(start_page(true, Some("https://crew.example.ts.net/".into())), Ok(Start::Bundled));
        assert_eq!(start_page(true, None), Ok(Start::Bundled));
    }

    #[test]
    fn desktop_opens_the_configured_url() {
        assert_eq!(
            start_page(false, Some("https://crew.example.ts.net/".into())),
            Ok(Start::Remote(Url::parse("https://crew.example.ts.net/").unwrap()))
        );
        assert_eq!(start_page(false, None), Ok(Start::Remote(Url::parse(DEFAULT_URL).unwrap())));
    }
}
