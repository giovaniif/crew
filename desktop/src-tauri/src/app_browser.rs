use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::browse::{
    self, cookies_result, label, page_result, plan, read_result, read_script, run_script,
    tabs_result, Call, CookieRow, Step, INIT_SCRIPT, PAGE,
};

const STEP_TIMEOUT: Duration = Duration::from_secs(30);
const WAIT_TIMEOUT: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(50);

#[derive(Default)]
pub struct Browsers {
    serve: Mutex<Option<Url>>,
    windows: Mutex<HashMap<String, String>>,
    loads: Mutex<HashMap<String, u64>>,
    next: AtomicUsize,
    ids: AtomicU64,
}

impl Browsers {
    fn loads_of(&self, label: &str) -> u64 {
        *self.loads.lock().unwrap().get(label).unwrap_or(&0)
    }

    fn loaded(&self, label: &str) {
        *self
            .loads
            .lock()
            .unwrap()
            .entry(label.to_string())
            .or_default() += 1;
    }
}

pub fn set_serve(app: &AppHandle, url: &Url) {
    if let Some(state) = app.try_state::<Browsers>() {
        *state.serve.lock().unwrap() = Some(url.clone());
    }
}

fn existing(app: &AppHandle, session: &str) -> Option<WebviewWindow> {
    let state = app.state::<Browsers>();
    let label = state.windows.lock().unwrap().get(session).cloned()?;
    app.get_webview_window(&label)
}

pub fn open(app: &AppHandle, session: &str, url: Option<Url>) -> Result<WebviewWindow, String> {
    if let Some(window) = existing(app, session) {
        if let Some(url) = url {
            navigate(app, &window, url)?;
        }
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }
    let state = app.state::<Browsers>();
    let serve = state.serve.lock().unwrap().clone();
    let start = url.unwrap_or_else(|| Url::parse("about:blank").unwrap());
    if !browse::allow_navigation(&start, serve.as_ref()) {
        return Err(format!("the app browser does not open {start}"));
    }
    let name = label(state.next.fetch_add(1, Ordering::SeqCst));
    let guard = serve.clone();
    let window = WebviewWindowBuilder::new(app, &name, WebviewUrl::External(start))
        .title(format!("crew browser · {session}"))
        .inner_size(1280.0, 800.0)
        .initialization_script(INIT_SCRIPT)
        .on_navigation(move |target| browse::allow_navigation(target, guard.as_ref()))
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                if let Some(state) = window.app_handle().try_state::<Browsers>() {
                    state.loaded(window.label());
                }
            }
        })
        .build()
        .map_err(|e| e.to_string())?;
    state
        .windows
        .lock()
        .unwrap()
        .insert(session.to_string(), name);
    Ok(window)
}

fn navigate(app: &AppHandle, window: &WebviewWindow, url: Url) -> Result<(), String> {
    let serve = app.state::<Browsers>().serve.lock().unwrap().clone();
    if !browse::allow_navigation(&url, serve.as_ref()) {
        return Err(format!("the app browser does not open {url}"));
    }
    window.navigate(url).map_err(|e| e.to_string())
}

fn eval_value(window: &WebviewWindow, js: String) -> Result<String, String> {
    let (tx, rx) = mpsc::channel();
    window
        .eval_with_callback(js, move |value| {
            let _ = tx.send(value);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(STEP_TIMEOUT)
        .map_err(|_| "the page did not answer".to_string())
}

fn script(
    app: &AppHandle,
    window: &WebviewWindow,
    body: &str,
    params: &Value,
) -> Result<Value, String> {
    let state = app.state::<Browsers>();
    let id = state.ids.fetch_add(1, Ordering::SeqCst) + 1;
    let loads = state.loads_of(window.label());
    window
        .eval(run_script(id, body, params))
        .map_err(|e| e.to_string())?;
    let end = Instant::now() + STEP_TIMEOUT;
    while Instant::now() < end {
        let value = eval_value(window, read_script(id))?;
        if let Some(outcome) = read_result(&value) {
            return outcome;
        }
        if state.loads_of(window.label()) != loads {
            return Ok(json!("done: the page loaded a new document"));
        }
        std::thread::sleep(POLL);
    }
    Err(format!(
        "no result from the page in {}s",
        STEP_TIMEOUT.as_secs()
    ))
}

fn page(app: &AppHandle, window: &WebviewWindow) -> (String, String) {
    let value = script(app, window, PAGE, &json!({})).unwrap_or(Value::Null);
    let text = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    (text("url"), text("title"))
}

fn wait_load(app: &AppHandle, window: &WebviewWindow, before: u64) {
    let state = app.state::<Browsers>();
    let end = Instant::now() + STEP_TIMEOUT;
    while Instant::now() < end && state.loads_of(window.label()) == before {
        std::thread::sleep(POLL);
    }
}

pub fn execute(app: &AppHandle, call: &Call) -> Result<Value, String> {
    let step = plan(&call.command, &call.args)?;
    if let Step::Goto(url) = step {
        let window = open(app, &call.session, None)?;
        let before = app.state::<Browsers>().loads_of(window.label());
        navigate(app, &window, url)?;
        wait_load(app, &window, before);
        let (url, title) = page(app, &window);
        return Ok(page_result("opened ", &url, &title));
    }
    let window = open(app, &call.session, None)?;
    match step {
        Step::Goto(_) => unreachable!(),
        Step::Script { body, params } => script(app, &window, &body, &params),
        Step::WaitFor { body, params } => {
            let end = Instant::now() + WAIT_TIMEOUT;
            while Instant::now() < end {
                if script(app, &window, &body, &params) == Ok(Value::Bool(true)) {
                    return Ok(json!("found"));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err("timed out after 10 s".into())
        }
        Step::Sleep(ms) => {
            std::thread::sleep(Duration::from_millis(ms));
            Ok(json!(format!("waited {ms} ms")))
        }
        Step::Screenshot => screenshot(&window),
        Step::Tabs => {
            let (url, title) = page(app, &window);
            Ok(tabs_result(&url, &title))
        }
        Step::Cookies(domain) => {
            let cookies = window.cookies().map_err(|e| e.to_string())?;
            let rows: Vec<CookieRow> = cookies
                .iter()
                .map(|c| CookieRow {
                    name: c.name().to_string(),
                    domain: c.domain().unwrap_or_default().to_string(),
                    path: c.path().unwrap_or("/").to_string(),
                })
                .collect();
            Ok(cookies_result(&rows, domain.as_deref()))
        }
        Step::Device {
            name,
            width,
            height,
        } => {
            window
                .set_size(LogicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
            Ok(json!(format!("device {name}")))
        }
    }
}

#[cfg(target_os = "macos")]
fn screenshot(window: &WebviewWindow) -> Result<Value, String> {
    use base64::Engine;
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;

    let (tx, rx) = mpsc::channel::<Result<(Vec<u8>, isize, isize), String>>();
    window
        .with_webview(move |platform| {
            let view = platform.inner() as *const WKWebView;
            let tx = tx.clone();
            let done = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let outcome = unsafe { image.as_ref() }
                    .and_then(|image| image.TIFFRepresentation())
                    .and_then(|tiff| NSBitmapImageRep::imageRepWithData(&tiff))
                    .and_then(|rep| {
                        let png = unsafe {
                            rep.representationUsingType_properties(
                                NSBitmapImageFileType::PNG,
                                &NSDictionary::new(),
                            )
                        }?;
                        Some((png.to_vec(), rep.pixelsWide(), rep.pixelsHigh()))
                    })
                    .ok_or_else(|| match unsafe { error.as_ref() } {
                        Some(error) => error.localizedDescription().to_string(),
                        None => "the webview made no image".to_string(),
                    });
                let _ = tx.send(outcome);
            });
            unsafe {
                if let Some(view) = view.as_ref() {
                    view.takeSnapshotWithConfiguration_completionHandler(None, &done);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    let (png, width, height) = rx
        .recv_timeout(STEP_TIMEOUT)
        .map_err(|_| "the webview made no screenshot".to_string())??;
    Ok(json!({
        "png": base64::engine::general_purpose::STANDARD.encode(png),
        "width": width,
        "height": height,
    }))
}

#[cfg(not(target_os = "macos"))]
fn screenshot(_window: &WebviewWindow) -> Result<Value, String> {
    Err("screenshot: the app browser makes screenshots only on macOS: use snapshot".into())
}

pub fn watch(app: AppHandle, crew: PathBuf) {
    std::thread::spawn(move || loop {
        let handle = app.clone();
        let started = Instant::now();
        let result = browse::run_bridge(&crew, move |call, responder| {
            let app = handle.clone();
            std::thread::spawn(move || responder.send(execute(&app, &call)));
        });
        if let Err(err) = result {
            eprintln!("crew-desktop: crew browser attach: {err}");
        }
        let pause = if started.elapsed() < Duration::from_secs(10) {
            Duration::from_secs(5)
        } else {
            Duration::from_secs(1)
        };
        std::thread::sleep(pause);
    });
}
