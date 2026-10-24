use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::servers::{write_private, Kind, Server, Store, LOCAL_ID};

pub const MACHINES_FILE: &str = "machines.json";
pub const SERVERS_FILE: &str = "servers.json";
pub const THIS_NAME: &str = "This Mac";
pub const STREAM_EVENT: &str = "crew-machine-stream";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Machine {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_address: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth: Option<Value>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct MachineFile {
    #[serde(default)]
    pub machines: Vec<Machine>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected: Option<String>,
}

#[derive(Deserialize)]
struct LegacyStore {
    #[serde(default)]
    servers: Vec<Server>,
}

impl From<&Store> for MachineFile {
    fn from(store: &Store) -> Self {
        MachineFile {
            machines: store.servers.iter().map(machine_of).collect(),
            selected: Some(store.selected.clone()).filter(|id| id != LOCAL_ID),
        }
    }
}

impl From<MachineFile> for Store {
    fn from(file: MachineFile) -> Self {
        let mut store = Store::default();
        store.servers.clear();
        for machine in file.machines {
            if let Some(server) = server_of(machine) {
                if !store.servers.iter().any(|s| s.id == server.id) {
                    store.servers.push(server);
                }
            }
        }
        if let Some(id) = file.selected {
            store.selected = id;
        }
        store
    }
}

fn machine_of(server: &Server) -> Machine {
    let (kind, ssh_address, url) = match &server.kind {
        Kind::Local => ("this", None, None),
        Kind::Ssh { host } => ("ssh", Some(host.clone()), None),
        Kind::Url { url } => ("url", None, Some(url.clone())),
    };
    Machine {
        id: server.id.clone(),
        name: if server.kind == Kind::Local { THIS_NAME.to_string() } else { server.kind.name() },
        kind: kind.to_string(),
        ssh_address,
        url,
        auth: server.auth.clone(),
    }
}

fn server_of(machine: Machine) -> Option<Server> {
    let kind = match machine.kind.as_str() {
        "this" => Kind::Local,
        "ssh" => Kind::Ssh { host: machine.ssh_address? },
        "url" => Kind::Url { url: machine.url? },
        _ => return None,
    };
    let id = if kind == Kind::Local { LOCAL_ID.to_string() } else { kind.id() };
    Some(Server { id, kind, auth: machine.auth })
}

pub fn migrate(dir: &Path) -> io::Result<bool> {
    let target = dir.join(MACHINES_FILE);
    if target.exists() {
        return Ok(false);
    }
    let source = dir.join(SERVERS_FILE);
    let bytes = match std::fs::read(&source) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(err),
    };
    let backup = dir.join(format!("{SERVERS_FILE}.bak"));
    if !backup.exists() {
        write_private(&backup, &bytes)?;
    }
    let legacy: LegacyStore = serde_json::from_slice(&bytes).unwrap_or(LegacyStore { servers: Vec::new() });
    let mut store = Store::default();
    for server in legacy.servers {
        if server.kind != Kind::Local && !store.servers.iter().any(|s| s.id == server.id) {
            store.servers.push(server);
        }
    }
    store.save(&target)?;
    Ok(true)
}

pub fn request_target(method: &str, path: &str) -> Result<(), String> {
    if !matches!(method, "GET" | "POST" | "DELETE") {
        return Err(format!("the method {method} is not allowed"));
    }
    let route = path.split(['?', '#']).next().unwrap_or("");
    let refused = !route.starts_with("/api/v1/")
        || path.chars().any(|c| c.is_control() || c.is_whitespace())
        || route.split('/').any(|part| part == ".." || part == ".")
        || route.contains("//")
        || route == "/api/v1/pair"
        || route.starts_with("/api/v1/pair/")
        || route == "/api/v1/stream"
        || route.starts_with("/api/v1/terminal/");
    if refused {
        return Err(format!("the path {path} is not allowed"));
    }
    Ok(())
}

fn strip_tokens(value: &mut Value) {
    match value {
        Value::Object(map) => {
            map.remove("token");
            map.values_mut().for_each(strip_tokens);
        }
        Value::Array(items) => items.iter_mut().for_each(strip_tokens),
        _ => {}
    }
}

pub fn scrub(body: &str, token: &str) -> Result<String, String> {
    let text = match serde_json::from_str::<Value>(body) {
        Ok(mut value) => {
            strip_tokens(&mut value);
            value.to_string()
        }
        Err(_) => body.to_string(),
    };
    if !token.is_empty() && text.contains(token) {
        return Err("the answer held the login of the machine, so the app dropped it".into());
    }
    Ok(text)
}
