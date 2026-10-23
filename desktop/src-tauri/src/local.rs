use std::ffi::{OsStr, OsString};
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

pub const FALLBACK_DIRS: [&str; 2] = ["/usr/local/bin", "/opt/homebrew/bin"];

pub fn serve_path(parent: Option<&OsStr>, login: Option<String>, home: Option<&Path>) -> OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let mut add = |dir: PathBuf| {
        if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    };
    if let Some(login) = login {
        std::env::split_paths(&login).for_each(&mut add);
    }
    if let Some(parent) = parent {
        std::env::split_paths(parent).for_each(&mut add);
    }
    if let Some(home) = home {
        add(home.join(".local/bin"));
    }
    FALLBACK_DIRS.iter().map(PathBuf::from).for_each(&mut add);
    std::env::join_paths(dirs)
        .unwrap_or_else(|_| parent.map(OsStr::to_os_string).unwrap_or_default())
}

pub fn login_path(shell: &Path, timeout: Duration) -> Option<String> {
    let mut child = Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let end = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if Instant::now() < end => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let path = out.trim().to_string();
    (!path.is_empty()).then_some(path)
}

pub fn child_path() -> OsString {
    static PATH: std::sync::OnceLock<OsString> = std::sync::OnceLock::new();
    PATH.get_or_init(read_child_path).clone()
}

fn read_child_path() -> OsString {
    let login = std::env::var_os("SHELL")
        .filter(|s| !s.is_empty())
        .and_then(|shell| login_path(Path::new(&shell), Duration::from_secs(3)));
    let home = std::env::var_os("HOME").map(PathBuf::from);
    serve_path(std::env::var_os("PATH").as_deref(), login, home.as_deref())
}

pub fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/")
}

pub struct LocalServe {
    child: Child,
    pub port: u16,
    log: Option<PathBuf>,
    exit: Option<std::process::ExitStatus>,
}

const TAIL_LINES: usize = 20;

pub fn start_serve(
    crew: &Path,
    port: u16,
    log: &Path,
    timeout: Duration,
) -> Result<LocalServe, String> {
    let mut serve = LocalServe::start(crew, port, log).map_err(|e| e.to_string())?;
    if serve.wait_ready(timeout) {
        return Ok(serve);
    }
    serve.stop();
    let first = serve.problem();
    if !daemon_is_older(&first) {
        return Err(first);
    }
    let _ = Command::new(crew)
        .args(["daemon", "stop"])
        .env("PATH", child_path())
        .stdin(Stdio::null())
        .output();
    let mut again = LocalServe::start(crew, port, log).map_err(|e| e.to_string())?;
    if again.wait_ready(timeout) {
        return Ok(again);
    }
    again.stop();
    Err(format!(
        "The app stopped an older crew daemon, but crew serve still did not start.\n{}",
        again.problem()
    ))
}

fn daemon_is_older(problem: &str) -> bool {
    problem.contains("daemon runs crew") && problem.contains("restart the daemon")
}

impl LocalServe {
    pub fn start(crew: &Path, port: u16, log: &Path) -> io::Result<Self> {
        let mut command = Command::new(crew);
        command.args(serve_args(port)).env("PATH", child_path());
        if let Some(dir) = log.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let file = std::fs::File::create(log)?;
        command.stderr(Stdio::from(file));
        Self::run(command, port, Some(log.to_path_buf()))
    }

    pub fn spawn(program: &OsStr, args: &[String], port: u16) -> io::Result<Self> {
        let mut command = Command::new(program);
        command.args(args).stderr(Stdio::inherit());
        Self::run(command, port, None)
    }

    fn run(mut command: Command, port: u16, log: Option<PathBuf>) -> io::Result<Self> {
        command.stdin(Stdio::null()).stdout(Stdio::null());
        stop_with_parent(&mut command);
        let child = command.spawn()?;
        Ok(LocalServe {
            child,
            port,
            log,
            exit: None,
        })
    }

    pub fn problem(&mut self) -> String {
        let status = self.exit.or_else(|| self.child.try_wait().ok().flatten());
        let mut text = match status {
            Some(status) => format!("crew serve stopped ({status})."),
            None => "crew serve did not answer in time.".to_string(),
        };
        let output = self
            .log
            .as_ref()
            .and_then(|l| std::fs::read_to_string(l).ok())
            .unwrap_or_default();
        let lines: Vec<&str> = output.lines().filter(|l| !l.trim().is_empty()).collect();
        let tail = &lines[lines.len().saturating_sub(TAIL_LINES)..];
        if daemon_is_older(&output) || output.contains("restart this client") {
            text = format!(
                "crew serve and the crew daemon are different builds (version mismatch). {text}"
            );
        }
        if !tail.is_empty() {
            text.push_str("\n\n");
            text.push_str(&tail.join("\n"));
        }
        if let Some(log) = &self.log {
            text.push_str(&format!("\n\nLog: {}", log.display()));
        }
        text
    }

    pub fn wait_ready(&mut self, timeout: Duration) -> bool {
        let end = Instant::now() + timeout;
        while Instant::now() < end {
            if let Ok(Some(status)) = self.child.try_wait() {
                self.exit = Some(status);
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

    pub fn alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
            && matches!(
                request(self.port, "GET", "/api/v1/hello", None, None),
                Ok((200, _))
            )
    }

    pub fn stop(&mut self) {
        if self.exit.is_none() {
            self.exit = self.child.try_wait().ok().flatten();
        }
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
        .env("PATH", child_path())
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    pair_with(port, &pair_code(&out.stdout)?)
}

pub fn pair_code(output: &[u8]) -> Result<String, String> {
    let code: serde_json::Value = serde_json::from_slice(output).map_err(|e| e.to_string())?;
    code.get("code")
        .and_then(|c| c.as_str())
        .map(str::to_string)
        .ok_or_else(|| "no code from crew remote pair".to_string())
}

pub fn pair_with(port: u16, code: &str) -> Result<serde_json::Value, String> {
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
        .env("PATH", child_path())
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
        .env("PATH", child_path())
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
