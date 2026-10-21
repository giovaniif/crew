use url::Url;

pub fn serve_capability(url: &Url) -> Option<String> {
    if url.scheme() != "http" {
        return None;
    }
    let host = url.host_str()?;
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    let port = url.port()?;
    let origin = format!("http://{host}:{port}");
    Some(
        serde_json::json!({
            "identifier": "serve",
            "windows": ["main"],
            "remote": { "urls": [origin] },
            "permissions": ["core:default", "allow-crew-notify", "allow-crew-attention"]
        })
        .to_string(),
    )
}
