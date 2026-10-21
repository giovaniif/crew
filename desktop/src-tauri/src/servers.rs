use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use url::Url;

pub const LOCAL_ID: &str = "local";
pub const LOCAL_NAME: &str = "This computer";
pub const REMOTE_PATH: &str = r#"PATH="$PATH:$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin""#;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Kind {
    Local,
    Url { url: String },
    Ssh { host: String },
}

impl Kind {
    pub fn id(&self) -> String {
        match self {
            Kind::Local => LOCAL_ID.to_string(),
            Kind::Url { url } => format!("url:{url}"),
            Kind::Ssh { host } => format!("ssh:{host}"),
        }
    }

    pub fn name(&self) -> String {
        match self {
            Kind::Local => LOCAL_NAME.to_string(),
            Kind::Url { url } => Url::parse(url)
                .ok()
                .and_then(|u| u.host_str().map(str::to_string))
                .unwrap_or_else(|| url.clone()),
            Kind::Ssh { host } => host.clone(),
        }
    }

    pub fn detail(&self) -> String {
        match self {
            Kind::Local => "crew on this computer".to_string(),
            Kind::Url { url } => url.clone(),
            Kind::Ssh { host } => format!("{host} over SSH"),
        }
    }

    pub fn word(&self) -> &'static str {
        match self {
            Kind::Local => "local",
            Kind::Url { .. } => "url",
            Kind::Ssh { .. } => "ssh",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Server {
    pub id: String,
    #[serde(flatten)]
    pub kind: Kind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Row {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Store {
    pub servers: Vec<Server>,
    pub selected: String,
}

impl Default for Store {
    fn default() -> Self {
        Store {
            servers: vec![Server {
                id: LOCAL_ID.to_string(),
                kind: Kind::Local,
                auth: None,
            }],
            selected: LOCAL_ID.to_string(),
        }
    }
}

impl Store {
    pub fn load(file: &Path) -> (Store, bool) {
        let Ok(bytes) = std::fs::read(file) else {
            return (Store::default(), true);
        };
        let mut store: Store = serde_json::from_slice(&bytes).unwrap_or_default();
        if !store.servers.iter().any(|s| s.kind == Kind::Local) {
            store.servers.insert(0, Store::default().servers.remove(0));
        }
        if store.get(&store.selected).is_none() {
            store.selected = LOCAL_ID.to_string();
        }
        (store, false)
    }

    pub fn save(&self, file: &Path) -> io::Result<()> {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        let tmp = file.with_extension("json.tmp");
        write_private(&tmp, text.as_bytes())?;
        std::fs::rename(&tmp, file)
    }

    pub fn get(&self, id: &str) -> Option<&Server> {
        self.servers.iter().find(|s| s.id == id)
    }

    pub fn add(&mut self, kind: Kind, auth: Option<serde_json::Value>) -> String {
        let id = kind.id();
        match self.servers.iter_mut().find(|s| s.id == id) {
            Some(server) => server.auth = auth,
            None => self.servers.push(Server {
                id: id.clone(),
                kind,
                auth,
            }),
        }
        id
    }

    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        if id == LOCAL_ID {
            return Err("This computer cannot be removed".into());
        }
        let before = self.servers.len();
        self.servers.retain(|s| s.id != id);
        if self.servers.len() == before {
            return Err(format!("no server {id}"));
        }
        if self.selected == id {
            self.selected = LOCAL_ID.to_string();
        }
        Ok(())
    }

    pub fn select(&mut self, id: &str) -> Result<(), String> {
        if self.get(id).is_none() {
            return Err(format!("no server {id}"));
        }
        self.selected = id.to_string();
        Ok(())
    }

    pub fn rows(&self) -> Vec<Row> {
        self.servers
            .iter()
            .map(|s| Row {
                id: s.id.clone(),
                name: s.kind.name(),
                kind: s.kind.word(),
                detail: s.kind.detail(),
            })
            .collect()
    }
}

fn write_private(file: &Path, bytes: &[u8]) -> io::Result<()> {
    let _ = std::fs::remove_file(file);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options.open(file)?.write_all(bytes)
}

pub fn ssh_hosts(config: &str) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    for line in config.lines() {
        let mut words = line
            .split(|c: char| c == ' ' || c == '\t' || c == '=')
            .filter(|w| !w.is_empty());
        let Some(keyword) = words.next() else { continue };
        if !keyword.eq_ignore_ascii_case("host") {
            continue;
        }
        for name in words {
            if name.contains(['*', '?', '!']) || hosts.iter().any(|h| h == name) {
                continue;
            }
            hosts.push(name.to_string());
        }
    }
    hosts
}

pub fn ssh_target(text: &str) -> Option<String> {
    let target = text.trim();
    if target.is_empty()
        || target.starts_with('-')
        || target.contains(|c: char| c.is_whitespace() || c == '\'' || c == '"')
    {
        return None;
    }
    Some(target.to_string())
}

pub fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', r#"'\''"#))
}

pub fn ssh_argv(host: &str, options: &[&str], script: &str) -> Vec<String> {
    let mut argv = vec!["ssh".to_string(), "-T".to_string()];
    for option in ["BatchMode=yes", "RemoteCommand=none", "RequestTTY=no", "ConnectTimeout=10"]
        .iter()
        .chain(options)
    {
        argv.push("-o".into());
        argv.push(option.to_string());
    }
    argv.push("--".into());
    argv.push(host.to_string());
    argv.push(format!("sh -c {}", shell_quote(&format!("{REMOTE_PATH}; {script}"))));
    argv
}

pub fn setup_argv(host: &str) -> Vec<String> {
    ssh_argv(host, &[], "crew setup daemon && crew setup daemon --check")
}

pub fn check_argv(host: &str) -> Vec<String> {
    ssh_argv(host, &[], "crew setup daemon --check")
}

pub fn pair_argv(host: &str) -> Vec<String> {
    ssh_argv(host, &[], "crew remote pair --json --name desktop")
}

pub fn tunnel_argv(host: &str, local_port: u16, remote_port: u16) -> Vec<String> {
    let forward = format!("{local_port}:127.0.0.1:{remote_port}");
    let script = format!("exec crew serve --addr 127.0.0.1:{remote_port} --url http://127.0.0.1:{local_port}");
    let mut argv = ssh_argv(host, &["ExitOnForwardFailure=yes", "ServerAliveInterval=15"], &script);
    let at = argv.iter().position(|a| a == "--").unwrap_or(argv.len());
    argv.splice(at..at, ["-L".to_string(), forward]);
    argv
}

#[derive(Deserialize)]
struct Check {
    #[serde(default)]
    installed: bool,
    #[serde(default)]
    running: bool,
    #[serde(default)]
    failing: bool,
    #[serde(default)]
    reason: Option<String>,
}

pub fn check_failure(output: &str) -> Option<String> {
    let line = output.lines().rev().find(|l| l.trim_start().starts_with('{'));
    let Some(check) = line.and_then(|l| serde_json::from_str::<Check>(l).ok()) else {
        let said = output.trim();
        return Some(if said.is_empty() {
            "crew setup daemon --check gave no answer".to_string()
        } else {
            said.to_string()
        });
    };
    if check.failing {
        return Some(check.reason.unwrap_or_else(|| "the daemon fails".into()));
    }
    if !check.installed {
        return Some("the daemon is not set up as a service".into());
    }
    if !check.running {
        return Some("the daemon is installed but not running".into());
    }
    None
}

pub fn ssh_failure(host: &str, status: Option<i32>, stderr: &str) -> String {
    let said = stderr.trim();
    if status == Some(255) && said.contains("Permission denied") {
        return format!(
            "Could not log in to {host} without a password. crew runs ssh -o BatchMode=yes, so set up key login (ssh-copy-id {host}), load the key into ssh-agent, or use Tailscale SSH. ssh said: {said}"
        );
    }
    if said.contains("crew: not found") || said.contains("crew: command not found") {
        return format!("crew is not installed on {host}. Install it in ~/.local/bin, then try again.");
    }
    let code = status.map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
    if said.is_empty() {
        format!("ssh {host} failed (exit {code})")
    } else {
        format!("ssh {host} failed (exit {code}): {said}")
    }
}

pub fn server_url(input: &str) -> Option<String> {
    let text = input.trim();
    if text.is_empty() {
        return None;
    }
    let has_scheme = text
        .split_once("://")
        .map(|(s, _)| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c)))
        .unwrap_or(false);
    let full = if has_scheme { text.to_string() } else { format!("https://{text}") };
    let url = Url::parse(&full).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().unwrap_or("").is_empty() {
        return None;
    }
    Some(format!("{}/", url.origin().ascii_serialization()))
}

pub fn connect_url(ios: bool) -> &'static str {
    if ios {
        "tauri://localhost/index.html?change"
    } else {
        "http://tauri.localhost/index.html?change"
    }
}
