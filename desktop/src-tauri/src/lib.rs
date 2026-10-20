use tauri::{WebviewUrl, WebviewWindowBuilder};
use url::Url;

pub const DEFAULT_URL: &str = "http://127.0.0.1:7420/";

pub fn start_url(configured: Option<String>) -> Result<Url, url::ParseError> {
    match configured.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Url::parse(value),
        _ => Url::parse(DEFAULT_URL),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let url = start_url(std::env::var("CREW_URL").ok()).expect("CREW_URL is not a valid URL");
    tauri::Builder::default()
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.clone()))
                .title("crew")
                .inner_size(1280.0, 800.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the crew app failed to start");
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
