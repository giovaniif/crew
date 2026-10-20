use std::ffi::OsStr;
use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

pub const DEVICE_NAME: &str = "desktop";

pub fn crew_name() -> &'static str {
    if cfg!(windows) {
        "crew.exe"
    } else {
        "crew"
    }
}

pub fn free_port() -> io::Result<u16> {
    Ok(TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port())
}

pub fn find_crew(bundled: Option<&Path>, path: Option<&OsStr>) -> Option<PathBuf> {
    let bundled = bundled.map(|dir| dir.to_path_buf()).into_iter();
    let on_path = path
        .map(|p| std::env::split_paths(p).collect::<Vec<_>>())
        .unwrap_or_default();
    bundled
        .chain(on_path)
        .map(|dir| dir.join(crew_name()))
        .find(|file| file.is_file())
}

pub fn serve_args(port: u16) -> Vec<String> {
    let addr = format!("127.0.0.1:{port}");
    vec![
        "serve".into(),
        "--addr".into(),
        addr.clone(),
        "--url".into(),
        format!("http://{addr}"),
    ]
}

pub fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/")
}

pub struct LocalServe {
    child: Child,
    pub port: u16,
}

impl LocalServe {
    pub fn start(crew: &Path, port: u16) -> io::Result<Self> {
        let mut command = Command::new(crew);
        command
            .args(serve_args(port))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit());
        stop_with_parent(&mut command);
        let child = command.spawn()?;
        Ok(LocalServe { child, port })
    }

    pub fn wait_ready(&mut self, timeout: Duration) -> bool {
        let end = Instant::now() + timeout;
        while Instant::now() < end {
            if let Ok(Some(_)) = self.child.try_wait() {
                return false;
            }
            if matches!(
                request(self.port, "GET", "/api/v1/hello", None, None),
                Ok((200, _))
            ) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        false
    }

    pub fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for LocalServe {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(target_os = "linux")]
fn stop_with_parent(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    unsafe {
        command.pre_exec(|| {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(not(target_os = "linux"))]
fn stop_with_parent(_command: &mut Command) {}

pub fn request(
    port: u16,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<&str>,
) -> io::Result<(u16, String)> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let body = body.unwrap_or("");
    let auth = token
        .map(|t| format!("Authorization: Bearer {t}\r\n"))
        .unwrap_or_default();
    write!(
        stream,
        "{method} {path} HTTP/1.0\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\n{auth}Content-Length: {}\r\n\r\n{body}",
        body.len()
    )?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw)?;
    let status = raw
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "no HTTP status"))?;
    let body = raw
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    Ok((status, body))
}

pub fn token_works(port: u16, auth: &serde_json::Value) -> bool {
    let Some(token) = auth.get("token").and_then(|t| t.as_str()) else {
        return false;
    };
    matches!(
        request(port, "GET", "/api/v1/workspaces", Some(token), None),
        Ok((200, _))
    )
}

pub fn pair(crew: &Path, port: u16) -> Result<serde_json::Value, String> {
    let out = Command::new(crew)
        .args(["remote", "pair", "--json", "--name", DEVICE_NAME])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let code: serde_json::Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    let code = code
        .get("code")
        .and_then(|c| c.as_str())
        .ok_or("no code from crew remote pair")?;
    let body = serde_json::json!({ "code": code, "name": DEVICE_NAME }).to_string();
    let (status, reply) =
        request(port, "POST", "/api/v1/pair", None, Some(&body)).map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(format!("pair answered {status}: {reply}"));
    }
    let paired: serde_json::Value = serde_json::from_str(&reply).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "token": paired["token"], "device": paired["device"] }))
}

fn daemon_check(crew: &Path) -> (bool, String) {
    let Ok(out) = Command::new(crew)
        .args(["setup", "daemon", "--check"])
        .stdin(Stdio::null())
        .output()
    else {
        return (false, String::new());
    };
    let Ok(check) = serde_json::from_slice::<serde_json::Value>(&out.stdout) else {
        return (false, String::new());
    };
    let failing = check
        .get("failing")
        .and_then(|f| f.as_bool())
        .unwrap_or(false);
    let reason = check
        .get("reason")
        .and_then(|r| r.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    (failing, reason)
}

pub fn fix_daemon(crew: &Path) -> Result<(), String> {
    let out = Command::new(crew)
        .args(["setup", "daemon"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("run {}: {e}", crew.display()))?;
    let (failing, reason) = daemon_check(crew);
    if out.status.success() && !failing {
        return Ok(());
    }
    if !reason.is_empty() {
        return Err(reason);
    }
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !stderr.is_empty() {
        return Err(stderr);
    }
    Err("crew setup daemon failed".to_string())
}
