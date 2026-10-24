#[cfg(desktop)]
pub mod app_browser;
pub mod attention;
pub mod browse;
pub mod hub;
pub mod ipc;
pub mod local;
pub mod machines;
pub mod servers;
pub mod update;

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, RunEvent, Runtime, Webview, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use url::Url;

use attention::Banner;
#[cfg(desktop)]
use attention::{Action, Entry};
use hub::{FixTarget, Hub};
use local::LocalServe;
use servers::{Kind, LOCAL_ID};

#[cfg(desktop)]
const TRAY: &str = "crew";

#[cfg(desktop)]

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
    remote: bool,
}

type Shared = Mutex<Hub>;

static WINDOWS: AtomicUsize = AtomicUsize::new(0);

#[cfg(desktop)]
static BROWSER_BRIDGE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

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
    let url = Url::parse(&local::base_url(port)).map_err(|e| e.to_string())?;
    let serve = match local::start_serve(&crew, port, &serve_log(app), Duration::from_secs(20)) {
        Ok(serve) => serve,
        Err(problem) => {
            return Ok(Started {
                url: None,
                auth: None,
                problem: Some(problem),
                remote: false,
            })
        }
    };
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
    #[cfg(desktop)]
    {
        app_browser::set_serve(app, &url);
        if !BROWSER_BRIDGE.swap(true, Ordering::SeqCst) {
            app_browser::watch(app.clone(), crew.clone());
        }
    }
    if let Some(state) = app.try_state::<Shared>() {
        let mut hub = state.lock().unwrap();
        hub.crew = Some(crew);
        hub.local = Some((url.clone(), auth.clone()));
    }
    Ok(Started {
        url: Some(url),
        auth,
        problem: None,
        remote: false,
    })
}

fn add_capability(app: &AppHandle, capability: Option<String>) {
    if let Some(capability) = capability {
        if let Err(err) = app.add_capability(capability) {
            eprintln!("crew-desktop: no IPC for crew serve: {err}");
        }
    }
}

fn open_window(app: &AppHandle, started: Started) -> tauri::Result<()> {
    let n = WINDOWS.fetch_add(1, Ordering::SeqCst);
    let label = if n == 0 {
        "main".to_string()
    } else {
        format!("main-{n}")
    };
    if let Some(url) = started.url.as_ref() {
        let trusted = app
            .try_state::<Shared>()
            .map(|s| s.lock().unwrap().trusted(url))
            .unwrap_or(false);
        if !started.remote {
            add_capability(app, ipc::serve_capability(url));
        } else {
            add_capability(app, ipc::tunnel_capability(url));
        }
        if trusted {
            add_capability(app, ipc::server_capability(url));
        }
    }
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

fn serve_log(app: &AppHandle) -> PathBuf {
    app.path()
        .app_log_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("crew-desktop"))
        .join("serve.log")
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
        let again = local::start_serve(&crew, port, &serve_log(app), Duration::from_secs(20))?;
        *slot.lock().unwrap() = Some(again);
        return Ok(());
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

fn fix_ssh(app: &AppHandle, host: &str) -> Result<(), String> {
    hub::ssh_setup(host)?;
    let id = {
        let state = app.state::<Shared>();
        let mut hub = state.lock().unwrap();
        let id = hub
            .store
            .servers
            .iter()
            .find(|s| matches!(&s.kind, Kind::Ssh { host: h } if h == host))
            .map(|s| s.id.clone())
            .ok_or(format!("no server {host}"))?;
        if hub.tunnel_url(&id).is_some() {
            return Ok(());
        }
        id
    };
    let (url, auth) = connect(app, &id)?;
    show(app, url, auth, true)
}

#[tauri::command]
async fn crew_browser_open(
    app: AppHandle,
    webview: Webview,
    session: String,
    url: Option<String>,
) -> Result<(), String> {
    let page = webview.url().map_err(|e| e.to_string())?;
    let local = app
        .try_state::<Shared>()
        .and_then(|s| s.lock().unwrap().local.as_ref().map(|(u, _)| u.origin()));
    if local != Some(page.origin()) {
        return Err("only the page of this computer can open the app browser".into());
    }
    let url = url
        .filter(|u| !u.trim().is_empty())
        .map(|u| browse::address(&u))
        .transpose()?;
    #[cfg(desktop)]
    return blocking(move || app_browser::open(&app, &session, url).map(|_| ())).await;
    #[cfg(mobile)]
    {
        let _ = (session, url);
        Err("this device has no app browser".into())
    }
}

#[derive(serde::Serialize)]
struct UpdateCheck {
    current: String,
    latest: Option<String>,
}

#[tauri::command]
async fn crew_check_update(app: AppHandle) -> Result<UpdateCheck, String> {
    let current = app.package_info().version.to_string();
    #[cfg(desktop)]
    {
        let latest = update::check(&app, find_local_crew().as_deref(), &stop_serve).await?;
        Ok(UpdateCheck { current, latest })
    }
    #[cfg(mobile)]
    {
        Ok(UpdateCheck {
            current,
            latest: None,
        })
    }
}

#[tauri::command]
async fn crew_pick_folder(
    app: AppHandle,
    webview: Webview,
    near: Option<String>,
) -> Result<Option<String>, String> {
    let page = webview.url().map_err(|e| e.to_string())?;
    let local = app
        .try_state::<Shared>()
        .and_then(|s| s.lock().unwrap().local.as_ref().map(|(u, _)| u.origin()));
    if local != Some(page.origin()) {
        return Err("only the page of this computer can pick a folder".into());
    }
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let start = browse::folder_start(app.path().home_dir().ok().as_deref(), near.as_deref());
        let window = webview.window();
        return blocking(move || {
            let mut dialog = app
                .dialog()
                .file()
                .set_title("Choose a workspace folder")
                .set_parent(&window);
            if let Some(dir) = start {
                dialog = dialog.set_directory(dir);
            }
            Ok(dialog
                .blocking_pick_folder()
                .and_then(|p| p.into_path().ok())
                .map(|p| p.to_string_lossy().into_owned()))
        })
        .await;
    }
    #[cfg(mobile)]
    {
        let _ = near;
        Err("this device has no folder dialog".into())
    }
}

#[tauri::command]
async fn fix_daemon(app: AppHandle, webview: Webview) -> Result<(), String> {
    let page = webview.url().map_err(|e| e.to_string())?;
    let target = app
        .try_state::<Shared>()
        .map(|s| s.lock().unwrap().fix_target(&page))
        .unwrap_or(FixTarget::Local);
    blocking(move || match target {
        FixTarget::Local => fix_local(&app),
        FixTarget::Ssh(host) => fix_ssh(&app, &host),
    })
    .await
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

fn guard(app: &AppHandle, webview: &Webview) -> Result<(), String> {
    let page = webview.url().map_err(|e| e.to_string())?;
    let trusted = app
        .try_state::<Shared>()
        .map(|s| s.lock().unwrap().trusted(&page))
        .unwrap_or(false);
    if trusted {
        Ok(())
    } else {
        Err("only the page of this computer can manage servers".into())
    }
}

fn connect(app: &AppHandle, id: &str) -> Result<(Url, Option<serde_json::Value>), String> {
    let state = app.state::<Shared>();
    let server = state
        .lock()
        .unwrap()
        .store
        .get(id)
        .cloned()
        .ok_or(format!("no server {id}"))?;
    match &server.kind {
        Kind::Local => state
            .lock()
            .unwrap()
            .local
            .clone()
            .ok_or_else(|| "crew serve did not start on this computer".to_string()),
        Kind::Url { url } => Ok((
            Url::parse(url).map_err(|e| e.to_string())?,
            server.auth.clone(),
        )),
        Kind::Ssh { host } => {
            if let Some(url) = state.lock().unwrap().tunnel_url(id) {
                return Ok((url, server.auth.clone()));
            }
            hub::ssh_ensure_crew(host, &app_version(app))?;
            let tunnel = hub::ssh_tunnel(host)?;
            let port = tunnel.port;
            let saved = server.auth.clone().filter(|a| local::token_works(port, a));
            let auth = match saved {
                Some(auth) => auth,
                None => hub::ssh_pair(host, port, &app_version(app))?,
            };
            let mut hub = state.lock().unwrap();
            hub.store.add(server.kind.clone(), Some(auth.clone()));
            hub.save()?;
            hub.tunnels.insert(id.to_string(), tunnel);
            Ok((
                Url::parse(&local::base_url(port)).map_err(|e| e.to_string())?,
                Some(auth),
            ))
        }
    }
}

fn show(
    app: &AppHandle,
    url: Url,
    auth: Option<serde_json::Value>,
    remote: bool,
) -> Result<(), String> {
    open_window(
        app,
        Started {
            url: Some(url),
            auth,
            problem: None,
            remote,
        },
    )
    .map_err(|e| e.to_string())
}

fn open_server(app: &AppHandle, id: &str) -> Result<(), String> {
    let (url, auth) = connect(app, id)?;
    {
        let state = app.state::<Shared>();
        let mut hub = state.lock().unwrap();
        hub.store.select(id)?;
        hub.first_run = false;
        hub.save()?;
    }
    show(app, url, auth, id != LOCAL_ID)
}

#[tauri::command]
fn crew_servers(app: AppHandle, webview: Webview) -> Result<hub::Listing, String> {
    guard(&app, &webview)?;
    Ok(app.state::<Shared>().lock().unwrap().listing())
}

#[tauri::command]
fn crew_ssh_hosts(app: AppHandle, webview: Webview) -> Result<Vec<String>, String> {
    guard(&app, &webview)?;
    Ok(hub::ssh_config_hosts(app.path().home_dir().ok().as_deref()))
}

#[tauri::command]
async fn crew_server_add(
    app: AppHandle,
    webview: Webview,
    kind: String,
    target: String,
    code: Option<String>,
) -> Result<String, String> {
    guard(&app, &webview)?;
    blocking(move || {
        let state = app.state::<Shared>();
        match kind.as_str() {
            "url" => {
                let url = servers::server_url(&target).ok_or("That is not a valid address.")?;
                let parsed = Url::parse(&url).map_err(|e| e.to_string())?;
                let auth = hub::url_pair(&parsed, code.as_deref().unwrap_or(""))?;
                let mut hub = state.lock().unwrap();
                let id = hub.store.add(Kind::Url { url }, Some(auth));
                hub.save()?;
                Ok(id)
            }
            "ssh" => {
                let host =
                    servers::ssh_target(&target).ok_or("Type a host name, not ssh options.")?;
                hub::ssh_setup(&host)?;
                let tunnel = hub::ssh_tunnel(&host)?;
                let auth = hub::ssh_pair(&host, tunnel.port, &app_version(&app))?;
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

#[tauri::command]
async fn crew_server_open(app: AppHandle, webview: Webview, id: String) -> Result<(), String> {
    guard(&app, &webview)?;
    blocking(move || open_server(&app, &id)).await
}

#[tauri::command]
fn crew_server_remove(app: AppHandle, webview: Webview, id: String) -> Result<(), String> {
    guard(&app, &webview)?;
    let state = app.state::<Shared>();
    let mut hub = state.lock().unwrap();
    hub.store.remove(&id)?;
    hub.save()?;
    if let Some(mut tunnel) = hub.tunnels.remove(&id) {
        tunnel.stop();
    }
    Ok(())
}

fn app_version(app: &AppHandle) -> String {
    app.package_info().version.to_string()
}

#[derive(serde::Serialize)]
struct RemoteCrew {
    action: &'static str,
    server: Option<String>,
    app: String,
}

#[tauri::command]
async fn crew_server_crew(app: AppHandle, webview: Webview, target: String) -> Result<RemoteCrew, String> {
    guard(&app, &webview)?;
    blocking(move || {
        let host = servers::ssh_target(&target).ok_or("Type a host name, not ssh options.")?;
        let version = app_version(&app);
        let (action, server) = match hub::ssh_crew(&host, &version)? {
            servers::Plan::Install => ("install", None),
            servers::Plan::Upgrade(v) => ("upgrade", Some(v)),
            servers::Plan::Current | servers::Plan::Newer(_) => ("current", (version != "0.0.0").then(|| servers::tag(&version))),
        };
        Ok(RemoteCrew { action, server, app: servers::tag(&version) })
    })
    .await
}

#[tauri::command]
async fn crew_server_install(app: AppHandle, webview: Webview, target: String) -> Result<(), String> {
    guard(&app, &webview)?;
    blocking(move || {
        let host = servers::ssh_target(&target).ok_or("Type a host name, not ssh options.")?;
        hub::ssh_install(&host, &app_version(&app))
    })
    .await
}

#[tauri::command]
async fn crew_server_fix(app: AppHandle, webview: Webview, id: String) -> Result<(), String> {
    guard(&app, &webview)?;
    blocking(move || {
        let server = app
            .state::<Shared>()
            .lock()
            .unwrap()
            .store
            .get(&id)
            .cloned()
            .ok_or(format!("no server {id}"))?;
        match server.kind {
            Kind::Local => fix_local(&app),
            Kind::Ssh { host } => {
                hub::ssh_ensure_crew(&host, &app_version(&app))?;
                hub::ssh_setup(&host)
            }
            Kind::Url { .. } => Err("This server was added by its address, so the app cannot reach it over SSH. Run crew setup daemon on it, or add it again as an SSH server.".into()),
        }
    })
    .await
}

#[tauri::command]
async fn crew_server_workspace(
    app: AppHandle,
    webview: Webview,
    id: String,
    path: String,
) -> Result<(), String> {
    guard(&app, &webview)?;
    blocking(move || {
        let (url, auth) = connect(&app, &id)?;
        let token = hub::token_of(&auth).ok_or("this server is not paired")?;
        hub::add_workspace(&url, &token, path.trim())
    })
    .await
}

#[tauri::command]
async fn crew_server_complete(
    app: AppHandle,
    webview: Webview,
    id: String,
    path: String,
) -> Result<serde_json::Value, String> {
    guard(&app, &webview)?;
    blocking(move || {
        let (url, auth) = connect(&app, &id)?;
        let token = hub::token_of(&auth).ok_or("this server is not paired")?;
        hub::complete_path(&url, &token, &path)
    })
    .await
}

#[derive(serde::Serialize)]
struct MachineReply {
    status: u16,
    body: String,
}

#[tauri::command]
async fn crew_machine_request(
    app: AppHandle,
    webview: Webview,
    machine_id: String,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<MachineReply, String> {
    guard(&app, &webview)?;
    let method = method.to_ascii_uppercase();
    machines::request_target(&method, &path)?;
    blocking(move || {
        let (url, auth) = connect(&app, &machine_id)?;
        let token = hub::token_of(&auth).ok_or("this machine is not paired")?;
        let (status, reply) = hub::http(&url, &method, &path, Some(&token), body.as_deref())?;
        Ok(MachineReply {
            status,
            body: machines::scrub(&reply, &token)?,
        })
    })
    .await
}

#[derive(Default)]
struct Streams {
    next: AtomicUsize,
    open: Mutex<std::collections::HashMap<usize, std::sync::Arc<std::sync::atomic::AtomicBool>>>,
}

#[derive(Clone, serde::Serialize)]
struct StreamEvent {
    stream: usize,
    machine_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    closed: Option<String>,
}

#[tauri::command]
async fn crew_machine_stream(app: AppHandle, webview: Webview, machine_id: String) -> Result<usize, String> {
    guard(&app, &webview)?;
    let label = webview.label().to_string();
    let (url, auth) = {
        let app = app.clone();
        let id = machine_id.clone();
        blocking(move || connect(&app, &id)).await?
    };
    let token = hub::token_of(&auth).ok_or("this machine is not paired")?;
    let streams = app.state::<Streams>();
    let stream = streams.next.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    streams.open.lock().unwrap().insert(stream, stop.clone());
    let handle = app.clone();
    std::thread::spawn(move || {
        let send = |frame: Option<String>, closed: Option<String>| {
            use tauri::Emitter;
            let event = StreamEvent { stream, machine_id: machine_id.clone(), frame, closed };
            let _ = handle.emit_to(&label, machines::STREAM_EVENT, event);
        };
        let reason = hub::stream(&url, &token, &stop, |frame| match machines::scrub(&frame, &token) {
            Ok(text) => send(Some(text), None),
            Err(err) => eprintln!("crew-desktop: dropped a stream frame: {err}"),
        });
        handle.state::<Streams>().open.lock().unwrap().remove(&stream);
        send(None, Some(reason));
    });
    Ok(stream)
}

#[tauri::command]
fn crew_machine_stream_close(app: AppHandle, webview: Webview, stream: usize) -> Result<(), String> {
    guard(&app, &webview)?;
    if let Some(stop) = app.state::<Streams>().open.lock().unwrap().get(&stream) {
        stop.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn reopen(app: &AppHandle) {
    let selected = app.state::<Shared>().lock().unwrap().store.selected.clone();
    if hub::is_local(&selected) || configured_url().is_some() {
        return;
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Err(err) = open_server(&handle, &selected) {
            eprintln!("crew-desktop: cannot open {selected}: {err}");
        }
    });
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
fn on_menu(app: &AppHandle, id: &str) {
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
fn add_tray(app: &AppHandle) -> tauri::Result<()> {
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

fn stop_serve<R: Runtime>(handle: &AppHandle<R>) {
    if let Some(mut serve) = handle
        .state::<Mutex<Option<LocalServe>>>()
        .lock()
        .unwrap()
        .take()
    {
        serve.stop();
    }
    if let Some(state) = handle.try_state::<Shared>() {
        for (_, mut tunnel) in state.lock().unwrap().tunnels.drain() {
            tunnel.stop();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_notification::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    let app = builder
        .invoke_handler(tauri::generate_handler![
            crew_notify,
            crew_attention,
            fix_daemon,
            crew_servers,
            crew_ssh_hosts,
            crew_server_add,
            crew_server_open,
            crew_server_remove,
            crew_server_fix,
            crew_server_crew,
            crew_server_install,
            crew_server_workspace,
            crew_server_complete,
            crew_machine_request,
            crew_machine_stream,
            crew_machine_stream_close,
            crew_browser_open,
            crew_pick_folder,
            crew_check_update
        ])
        .manage(Mutex::new(None::<LocalServe>))
        .setup(|app| {
            if start_page(cfg!(mobile), None) == Ok(Start::Bundled) {
                let connect =
                    serde_json::Value::String(servers::connect_url(cfg!(target_os = "ios")).into());
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .initialization_script(format!("window.__CREW_CONNECT_URL__ = {connect};"))
                    .build()?;
                return Ok(());
            }
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            if let Err(err) = machines::migrate(&data) {
                eprintln!("crew-desktop: cannot migrate {}: {err}", data.join(machines::SERVERS_FILE).display());
            }
            app.manage(Mutex::new(Hub::open(data.join(machines::MACHINES_FILE))));
            app.manage(Streams::default());
            #[cfg(desktop)]
            app.manage(app_browser::Browsers::default());
            let handle = app.handle().clone();
            let started = match configured_url() {
                Some(value) => Started {
                    url: Some(start_url(Some(value))?),
                    auth: None,
                    problem: None,
                    remote: false,
                },
                None => {
                    let slot = app.state::<Mutex<Option<LocalServe>>>();
                    start_local(&handle, &slot).unwrap_or_else(|err| Started {
                        url: None,
                        auth: None,
                        problem: Some(err),
                        remote: false,
                    })
                }
            };
            open_window(&handle, started)?;
            #[cfg(desktop)]
            if let Err(err) = add_tray(app.handle()) {
                eprintln!("crew-desktop: no tray: {err}");
            }
            reopen(&handle);
            #[cfg(desktop)]
            if !update::off() {
                update::watch(app.handle().clone(), find_local_crew(), stop_serve);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("the crew app failed to start");
    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_serve(handle);
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
