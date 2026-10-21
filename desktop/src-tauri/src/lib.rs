pub mod attention;
pub mod hub;
pub mod local;
pub mod servers;

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use url::Url;

use attention::Banner;
#[cfg(desktop)]
use attention::{Action, Entry};
use hub::Hub;
use local::LocalServe;
use servers::Kind;

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
    {
        let state = app.state::<Shared>();
        let mut hub = state.lock().unwrap();
        hub.crew = Some(crew.clone());
        hub.local = Some((url.clone(), auth.clone()));
    }
    Ok(Started { url, auth })
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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_badge_count(attention::badge(&menu));
    }
    Ok(())
}

const SERVER_PERMISSIONS: &[&str] = &[
    "core:default",
    "allow-crew-notify",
    "allow-crew-attention",
    "allow-crew-servers",
    "allow-crew-ssh-hosts",
    "allow-crew-server-add",
    "allow-crew-server-open",
    "allow-crew-server-remove",
    "allow-crew-server-fix",
    "allow-crew-server-workspace",
    "allow-crew-server-auth",
];

type Shared = Mutex<Hub>;

fn allow_origin<R: Runtime>(app: &AppHandle<R>, url: &str) {
    let Ok(parsed) = Url::parse(url) else { return };
    let origin = parsed.origin().ascii_serialization();
    let mut capability = CapabilityBuilder::new(format!("server-{origin}"))
        .remote(format!("{origin}/*"))
        .window("main");
    for permission in SERVER_PERMISSIONS {
        capability = capability.permission(*permission);
    }
    if let Err(err) = app.add_capability(capability) {
        eprintln!("crew-desktop: no IPC for {origin}: {err}");
    }
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn crew_servers<R: Runtime>(app: AppHandle<R>) -> hub::Listing {
    app.state::<Shared>().lock().unwrap().listing()
}

#[tauri::command]
fn crew_ssh_hosts<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    hub::ssh_config_hosts(app.path().home_dir().ok().as_deref())
}

#[tauri::command]
fn crew_server_auth<R: Runtime>(app: AppHandle<R>, webview: tauri::Webview<R>) -> Option<serde_json::Value> {
    let page = webview.url().ok()?;
    app.state::<Shared>().lock().unwrap().auth_for(&page)
}

#[tauri::command]
async fn crew_server_add<R: Runtime>(app: AppHandle<R>, kind: String, target: String, code: Option<String>) -> Result<String, String> {
    let handle = app.clone();
    blocking(move || {
        let state = handle.state::<Shared>();
        match kind.as_str() {
            "url" => {
                let url = servers::server_url(&target).ok_or("That is not a valid address.")?;
                let auth = hub::url_pair(&Url::parse(&url).map_err(|e| e.to_string())?, code.as_deref().unwrap_or(""))?;
                let mut hub = state.lock().unwrap();
                let id = hub.store.add(Kind::Url { url: url.clone() }, Some(auth));
                hub.save()?;
                drop(hub);
                allow_origin(&handle, &url);
                Ok(id)
            }
            "ssh" => {
                let host = servers::ssh_target(&target).ok_or("Type a host name, not ssh options.")?;
                hub::ssh_setup(&host)?;
                let tunnel = hub::ssh_tunnel(&host)?;
                let auth = hub::ssh_pair(&host, tunnel.port)?;
                let mut hub = state.lock().unwrap();
                let id = hub.store.add(Kind::Ssh { host }, Some(auth));
                hub.save()?;
                hub.tunnels.insert(id.clone(), tunnel);
                Ok(id)
            }
            other => Err(format!("unknown server kind {other}")),
        }
    })
    .await
}

fn connect<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(Url, Option<String>), String> {
    let state = app.state::<Shared>();
    let server = state.lock().unwrap().store.get(id).cloned().ok_or(format!("no server {id}"))?;
    match &server.kind {
        Kind::Local => {
            let hub = state.lock().unwrap();
            let (url, auth) = hub.local.clone().ok_or("crew serve did not start on this computer")?;
            Ok((url, hub::token_of(&auth)))
        }
        Kind::Url { url } => Ok((Url::parse(url).map_err(|e| e.to_string())?, hub::token_of(&server.auth))),
        Kind::Ssh { host } => {
            if let Some(url) = state.lock().unwrap().tunnel_url(id) {
                return Ok((url, hub::token_of(&server.auth)));
            }
            let tunnel = hub::ssh_tunnel(host)?;
            let port = tunnel.port;
            let saved = server.auth.clone().filter(|a| local::token_works(port, a));
            let auth = match saved {
                Some(auth) => auth,
                None => hub::ssh_pair(host, port)?,
            };
            let mut hub = state.lock().unwrap();
            hub.store.add(server.kind.clone(), Some(auth.clone()));
            hub.save()?;
            hub.tunnels.insert(id.to_string(), tunnel);
            Ok((Url::parse(&local::base_url(port)).map_err(|e| e.to_string())?, hub::token_of(&Some(auth))))
        }
    }
}

fn show<R: Runtime>(app: &AppHandle<R>, url: Url) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("no main window")?;
    window.navigate(url).map_err(|e| e.to_string())
}

#[tauri::command]
async fn crew_server_open<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let handle = app.clone();
    blocking(move || {
        let (url, _) = connect(&handle, &id)?;
        {
            let state = handle.state::<Shared>();
            let mut hub = state.lock().unwrap();
            hub.store.select(&id)?;
            hub.first_run = false;
            hub.save()?;
        }
        show(&handle, url)
    })
    .await
}

#[tauri::command]
fn crew_server_remove<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let state = app.state::<Shared>();
    let mut hub = state.lock().unwrap();
    let was_selected = hub.store.selected == id;
    hub.store.remove(&id)?;
    hub.save()?;
    if let Some(mut tunnel) = hub.tunnels.remove(&id) {
        tunnel.stop();
    }
    let local = hub.local.clone();
    drop(hub);
    if was_selected {
        if let Some((url, _)) = local {
            show(&app, url)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn crew_server_fix<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    let handle = app.clone();
    blocking(move || {
        let state = handle.state::<Shared>();
        let (server, crew) = {
            let hub = state.lock().unwrap();
            (hub.store.get(&id).cloned().ok_or(format!("no server {id}"))?, hub.crew.clone())
        };
        match server.kind {
            Kind::Local => hub::local_setup(&crew.ok_or("crew is not in the app bundle or on PATH")?),
            Kind::Ssh { host } => hub::ssh_setup(&host),
            Kind::Url { .. } => Err("This server was added by its address, so the app cannot reach it over SSH. Run crew setup daemon on it, or add it again as an SSH server.".into()),
        }
    })
    .await
}

#[tauri::command]
async fn crew_server_workspace<R: Runtime>(app: AppHandle<R>, id: String, path: String) -> Result<(), String> {
    let handle = app.clone();
    blocking(move || {
        let (url, token) = connect(&handle, &id)?;
        hub::add_workspace(&url, &token.ok_or("this server is not paired")?, path.trim())
    })
    .await
}

fn reopen<R: Runtime>(app: &AppHandle<R>) {
    let (urls, selected) = {
        let state = app.state::<Shared>();
        let hub = state.lock().unwrap();
        let urls: Vec<String> = hub
            .store
            .servers
            .iter()
            .filter_map(|s| match &s.kind {
                Kind::Url { url } => Some(url.clone()),
                _ => None,
            })
            .collect();
        (urls, hub.store.selected.clone())
    };
    for url in &urls {
        allow_origin(app, url);
    }
    if hub::is_local(&selected) || configured_url().is_some() {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Err(err) = connect(&handle, &selected).and_then(|(url, _)| show(&handle, url)) {
            eprintln!("crew-desktop: cannot open {selected}: {err}");
        }
    });
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
            crew_servers,
            crew_ssh_hosts,
            crew_server_add,
            crew_server_open,
            crew_server_remove,
            crew_server_fix,
            crew_server_workspace,
            crew_server_auth
        ])
        .manage(Mutex::new(None::<LocalServe>))
        .setup(|app| {
            if start_page(cfg!(mobile), None) == Ok(Start::Bundled) {
                let connect = serde_json::Value::String(servers::connect_url(cfg!(target_os = "ios")).into());
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .initialization_script(format!("window.__CREW_CONNECT_URL__ = {connect};"))
                    .build()?;
                return Ok(());
            }
            let file = app.path().app_data_dir()?.join("servers.json");
            app.manage(Mutex::new(Hub::open(file)));
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
            #[cfg(desktop)]
            if let Err(err) = add_tray(app.handle()) {
                eprintln!("crew-desktop: no tray: {err}");
            }
            reopen(app.handle());
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
