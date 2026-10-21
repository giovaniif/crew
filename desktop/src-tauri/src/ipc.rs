use url::Url;

pub const SERVER_COMMANDS: &[&str] = &[
    "allow-crew-servers",
    "allow-crew-ssh-hosts",
    "allow-crew-server-add",
    "allow-crew-server-open",
    "allow-crew-server-remove",
    "allow-crew-server-fix",
    "allow-crew-server-workspace",
];

fn local_origin(url: &Url) -> Option<(String, u16)> {
    if url.scheme() != "http" {
        return None;
    }
    let host = url.host_str()?;
    if host != "127.0.0.1" && host != "localhost" {
        return None;
    }
    Some((host.to_string(), url.port()?))
}

fn capability(kind: &str, url: &Url, permissions: &[&str]) -> Option<String> {
    let (host, port) = local_origin(url)?;
    Some(
        serde_json::json!({
            "identifier": format!("{kind}-{host}-{port}"),
            "windows": ["main", "main-*"],
            "remote": { "urls": [format!("http://{host}:{port}")] },
            "permissions": permissions
        })
        .to_string(),
    )
}

pub fn server_capability(url: &Url) -> Option<String> {
    capability("servers", url, SERVER_COMMANDS)
}

pub fn tunnel_capability(url: &Url) -> Option<String> {
    capability("tunnel", url, &["allow-fix-daemon"])
}

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
            "identifier": format!("serve-{host}-{port}"),
            "windows": ["main", "main-*"],
            "remote": { "urls": [origin] },
            "permissions": ["core:default", "allow-crew-notify", "allow-crew-attention", "allow-fix-daemon"]
        })
        .to_string(),
    )
}
