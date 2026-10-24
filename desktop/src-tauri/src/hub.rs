use std::collections::HashMap;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use url::Url;

use crate::local::{self, LocalServe};
use crate::servers::{self, Kind, Row, Store, LOCAL_ID};

#[derive(Debug, PartialEq)]
pub enum FixTarget {
    Local,
    Ssh(String),
}

#[derive(Serialize)]
pub struct Listing {
    pub servers: Vec<Row>,
    pub selected: String,
    pub first_run: bool,
}

pub struct Hub {
    pub file: PathBuf,
    pub store: Store,
    pub first_run: bool,
    pub crew: Option<PathBuf>,
    pub local: Option<(Url, Option<serde_json::Value>)>,
    pub tunnels: HashMap<String, LocalServe>,
}

impl Hub {
    pub fn open(file: PathBuf) -> Hub {
        let (store, first_run) = Store::load(&file);
        if first_run {
            if let Err(err) = store.save(&file) {
                eprintln!("crew-desktop: cannot save {}: {err}", file.display());
            }
        }
        Hub {
            file,
            store,
            first_run,
            crew: None,
            local: None,
            tunnels: HashMap::new(),
        }
    }

    pub fn listing(&self) -> Listing {
        let first_run = self.first_run;
        Listing {
            servers: self.store.rows(),
            selected: self.store.selected.clone(),
            first_run,
        }
    }

    pub fn save(&self) -> Result<(), String> {
        self.store.save(&self.file).map_err(|e| e.to_string())
    }

    pub fn trusted(&self, page: &Url) -> bool {
        matches!(&self.local, Some((url, _)) if url.origin() == page.origin())
    }

    pub fn fix_target(&self, page: &Url) -> FixTarget {
        let origin = page.origin();
        for (id, tunnel) in &self.tunnels {
            if Url::parse(&local::base_url(tunnel.port)).map(|u| u.origin()).ok() != Some(origin.clone()) {
                continue;
            }
            if let Some(Kind::Ssh { host }) = self.store.get(id).map(|s| &s.kind) {
                return FixTarget::Ssh(host.clone());
            }
        }
        FixTarget::Local
    }

    pub fn tunnel_url(&mut self, id: &str) -> Option<Url> {
        let tunnel = self.tunnels.get_mut(id)?;
        if !tunnel.alive() {
            self.tunnels.remove(id);
            return None;
        }
        Url::parse(&local::base_url(tunnel.port)).ok()
    }
}

pub fn run(argv: &[String]) -> Result<(Option<i32>, String, String), String> {
    let out = Command::new(&argv[0])
        .args(&argv[1..])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("cannot run {}: {e}", argv[0]))?;
    Ok((
        out.status.code(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    ))
}

fn ssh(host: &str, argv: &[String]) -> Result<String, String> {
    let (status, out, err) = run(argv)?;
    if status != Some(0) {
        return Err(servers::ssh_failure(host, status, &err));
    }
    Ok(out)
}

pub fn ssh_setup(host: &str) -> Result<(), String> {
    let (status, out, err) = run(&servers::setup_argv(host))?;
    if status == Some(255) || out.trim().is_empty() {
        return Err(servers::ssh_failure(host, status, &err));
    }
    match servers::check_failure(&out) {
        Some(reason) => Err(format!("the daemon on {host} still fails after crew setup daemon: {reason}")),
        None => Ok(()),
    }
}

pub fn ssh_tunnel(host: &str) -> Result<LocalServe, String> {
    let port = local::free_port().map_err(|e| e.to_string())?;
    let argv = servers::tunnel_argv(host, port, port);
    let mut tunnel = LocalServe::spawn(OsStr::new(&argv[0]), &argv[1..], port).map_err(|e| e.to_string())?;
    if !tunnel.wait_ready(Duration::from_secs(30)) {
        tunnel.stop();
        return Err(format!("crew serve on {host} did not answer over the SSH tunnel"));
    }
    Ok(tunnel)
}

pub fn ssh_pair(host: &str, port: u16, app: &str) -> Result<serde_json::Value, String> {
    local::pair_with(port, &ssh_pair_code(host, app)?)
}

pub fn ssh_pair_code(host: &str, app: &str) -> Result<String, String> {
    let (status, out, err) = run(&servers::pair_argv(host))?;
    if status != Some(0) {
        if err.contains("flag provided but not defined") {
            let server = ssh(host, &servers::version_argv(host))
                .ok()
                .and_then(|o| servers::server_version(&o))
                .unwrap_or_else(|| "an unknown version".into());
            return Err(servers::too_old(host, &server, app));
        }
        return Err(servers::ssh_failure(host, status, &err));
    }
    local::pair_code(out.as_bytes())
}

pub fn ssh_crew(host: &str, app: &str) -> Result<servers::Plan, String> {
    let out = ssh(host, &servers::version_argv(host))?;
    match servers::plan(&out, app) {
        servers::Plan::Newer(server) => Err(servers::newer_failure(host, &server, app)),
        plan => Ok(plan),
    }
}

pub fn ssh_install(host: &str, app: &str) -> Result<(), String> {
    let (status, _, err) = run(&servers::install_argv(host, app))?;
    if status != Some(0) {
        let code = status.map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
        return Err(format!(
            "Could not install crew {} on {host} (exit {code}): {}",
            servers::tag(app),
            err.trim()
        ));
    }
    if ssh_crew(host, app)? == servers::Plan::Current {
        return Ok(());
    }
    let out = ssh(host, &servers::version_argv(host)).unwrap_or_default();
    let found = servers::server_version(&out).unwrap_or_else(|| "no crew".into());
    Err(format!(
        "crew {} is installed on {host}, but the crew on its PATH is still {found}. Remove the old crew, then try again.",
        servers::tag(app)
    ))
}

pub fn token_of(auth: &Option<serde_json::Value>) -> Option<String> {
    auth.as_ref()?.get("token")?.as_str().map(str::to_string)
}

#[cfg(desktop)]
pub fn http(base: &Url, method: &str, path: &str, token: Option<&str>, body: Option<&str>) -> Result<(u16, String), String> {
    let url = base.join(path.trim_start_matches('/')).map_err(|e| e.to_string())?;
    let mut request = ureq::request(method, url.as_str())
        .timeout(Duration::from_secs(15))
        .set("Content-Type", "application/json");
    if let Some(token) = token {
        request = request.set("Authorization", &format!("Bearer {token}"));
    }
    let result = match body {
        Some(body) => request.send_string(body),
        None => request.call(),
    };
    match result {
        Ok(reply) => Ok((reply.status(), reply.into_string().unwrap_or_default())),
        Err(ureq::Error::Status(code, reply)) => Ok((code, reply.into_string().unwrap_or_default())),
        Err(err) => Err(format!("cannot reach {}: {err}", base.origin().ascii_serialization())),
    }
}

#[cfg(not(desktop))]
pub fn http(_: &Url, _: &str, _: &str, _: Option<&str>, _: Option<&str>) -> Result<(u16, String), String> {
    Err("the server list is only in the desktop app".into())
}

pub fn error_text(status: u16, body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| format!("the server answered {status}"))
}

pub fn url_pair(url: &Url, code: &str) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({ "code": code.trim(), "name": local::DEVICE_NAME }).to_string();
    let (status, reply) = http(url, "POST", "/api/v1/pair", None, Some(&body))?;
    if status != 200 {
        return Err(format!("pairing failed: {}", error_text(status, &reply)));
    }
    let paired: serde_json::Value = serde_json::from_str(&reply).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "token": paired["token"], "device": paired["device"] }))
}

pub fn add_workspace(base: &Url, token: &str, path: &str) -> Result<(), String> {
    let body = serde_json::json!({ "path": path }).to_string();
    let (status, reply) = http(base, "POST", "/api/v1/workspaces", Some(token), Some(&body))?;
    if status != 200 {
        return Err(error_text(status, &reply));
    }
    Ok(())
}

pub fn ssh_config_hosts(home: Option<&Path>) -> Vec<String> {
    home.and_then(|h| std::fs::read_to_string(h.join(".ssh").join("config")).ok())
        .map(|text| servers::ssh_hosts(&text))
        .unwrap_or_default()
}

pub fn is_local(id: &str) -> bool {
    id == LOCAL_ID
}
