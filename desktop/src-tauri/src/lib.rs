use tauri::{WebviewUrl, WebviewWindowBuilder};
use url::Url;

pub const DEFAULT_URL: &str = "http://127.0.0.1:7420/";

#[derive(Debug, Clone, PartialEq, Eq)]
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

pub fn start(mobile: bool, configured: Option<String>) -> Result<Start, url::ParseError> {
    if mobile {
        return Ok(Start::Bundled);
    }
    start_url(configured).map(Start::Remote)
}

fn webview_url(start: &Start) -> WebviewUrl {
    match start {
        Start::Bundled => WebviewUrl::App("index.html".into()),
        Start::Remote(url) => WebviewUrl::External(url.clone()),
    }
}

#[cfg(desktop)]
fn open_window(app: &tauri::App, start: &Start) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", webview_url(start))
        .title("crew")
        .inner_size(1280.0, 800.0)
        .min_inner_size(900.0, 600.0)
        .build()?;
    Ok(())
}

#[cfg(mobile)]
fn open_window(app: &tauri::App, start: &Start) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", webview_url(start)).build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let start = start(cfg!(mobile), std::env::var("CREW_URL").ok()).expect("CREW_URL is not a valid URL");
    tauri::Builder::default()
        .setup(move |app| {
            open_window(app, &start)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the crew app failed to start");
}
