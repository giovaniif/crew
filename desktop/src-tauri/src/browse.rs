use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};
use url::Url;

pub const LABEL_PREFIX: &str = "browse-";

pub const CONSOLE_LINES: usize = 200;

pub const INIT_SCRIPT: &str = r#"(() => {
  if (window.__crewConsole) return;
  const lines = [];
  Object.defineProperty(window, "__crewConsole", { value: lines });
  const keep = (level, parts) => {
    const text = parts.map((p) => {
      if (typeof p === "string") return p;
      try { return JSON.stringify(p); } catch (e) { return String(p); }
    }).join(" ");
    lines.push(level + " " + text);
    if (lines.length > 200) lines.splice(0, lines.length - 200);
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const old = console[level];
    console[level] = function (...parts) {
      keep(level, parts);
      return old.apply(this, parts);
    };
  }
  window.addEventListener("error", (e) => keep("error", [e.message + " (" + e.filename + ":" + e.lineno + ")"]));
  window.addEventListener("unhandledrejection", (e) => keep("error", ["unhandled rejection: " + String(e.reason)]));
})();"#;

const MARK: &str = r#"const mark = (el) => {
  const old = el.style.outline;
  el.style.outline = "3px solid #f59e0b";
  setTimeout(() => { el.style.outline = old; }, 600);
};
"#;

const SNAPSHOT: &str = r##"const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);
for (const old of document.querySelectorAll("[data-crew-ref]")) old.removeAttribute("data-crew-ref");
let next = 1;
const lines = [];
const visible = (el) => {
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
};
const roleOf = (el) => {
  const role = el.getAttribute("role");
  if (role) return role;
  const tag = el.tagName.toLowerCase();
  if (tag === "a" && el.hasAttribute("href")) return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "img") return "img";
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "hidden") return "";
    if (type === "checkbox" || type === "radio") return type;
    if (type === "submit" || type === "button" || type === "reset") return "button";
    return "textbox";
  }
  return "";
};
const nameOf = (el) => {
  const label = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.getAttribute("placeholder");
  if (label) return label;
  if (el.id) {
    const labelled = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelled) return labelled.innerText;
  }
  if (el.tagName === "INPUT" && el.value) return el.value;
  return (el.innerText || "").trim();
};
const walk = (el, depth) => {
  if (skip.has(el.tagName.toUpperCase()) || !visible(el)) return;
  const role = roleOf(el);
  let inner = depth;
  if (role) {
    const ref = "e" + next++;
    el.setAttribute("data-crew-ref", ref);
    const name = nameOf(el).replace(/\s+/g, " ").slice(0, 100);
    lines.push("  ".repeat(depth) + "- " + role + (name ? " " + JSON.stringify(name) : "") + " [@" + ref + "]");
    inner = depth + 1;
  } else if (el.children.length === 0) {
    const text = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 200);
    if (text) lines.push("  ".repeat(depth) + "- text " + JSON.stringify(text));
  }
  for (const child of el.children) walk(child, inner);
};
if (document.body) walk(document.body, 0);
return {text: "# " + document.title + " — " + location.href + "\n" + lines.join("\n"), url: location.href, title: document.title, refs: next - 1};"##;

const CLICK: &str = r#"const el = document.querySelector(`[data-crew-ref="${ref}"]`);
if (!el) throw new Error("no element @" + ref + ": take a new snapshot");
el.scrollIntoView({block: "center"});
mark(el);
el.click();
return "clicked @" + ref;"#;

const FILL: &str = r#"const el = document.querySelector(`[data-crew-ref="${ref}"]`);
if (!el) throw new Error("no element @" + ref + ": take a new snapshot");
el.scrollIntoView({block: "center"});
mark(el);
el.focus();
const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(proto, "value");
if (setter && setter.set) setter.set.call(el, text); else el.value = text;
el.dispatchEvent(new Event("input", {bubbles: true}));
el.dispatchEvent(new Event("change", {bubbles: true}));
return "filled @" + ref;"#;

const TYPE: &str = r#"const el = document.activeElement;
if (!el || el === document.body) throw new Error("no focused element: click or fill one first");
if ("value" in el) {
  el.value = el.value + text;
  el.dispatchEvent(new Event("input", {bubbles: true}));
} else if (el.isContentEditable) {
  document.execCommand("insertText", false, text);
}
return "typed " + text.length + " characters";"#;

const PRESS: &str = r#"const el = document.activeElement || document.body;
const options = {key: key, bubbles: true, cancelable: true};
const allowed = el.dispatchEvent(new KeyboardEvent("keydown", options));
el.dispatchEvent(new KeyboardEvent("keyup", options));
if (allowed && key === "Enter" && el.form) {
  if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit();
}
return "pressed " + key;"#;

const EVAL: &str = r#"const value = await (0, eval)(js);
return value === undefined ? null : JSON.parse(JSON.stringify(value));"#;

const HAS_REF: &str = r#"return document.querySelector(`[data-crew-ref="${ref}"]`) !== null;"#;

const HAS_TEXT: &str =
    r#"return document.body !== null && document.body.innerText.includes(text);"#;

const CONSOLE: &str = r#"const lines = window.__crewConsole || [];
return {text: lines.length ? lines.join("\n") : "no console lines", lines: lines.slice()};"#;

pub const PAGE: &str = r#"return {url: location.href, title: document.title};"#;

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Goto(Url),
    Script {
        body: String,
        params: Value,
    },
    WaitFor {
        body: String,
        params: Value,
    },
    Sleep(u64),
    Screenshot,
    Tabs,
    Cookies(Option<String>),
    Device {
        name: String,
        width: f64,
        height: f64,
    },
}

#[derive(Debug, Clone, Deserialize)]
pub struct Call {
    pub call: u64,
    pub session: String,
    pub command: String,
    #[serde(default)]
    pub args: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CookieRow {
    pub name: String,
    pub domain: String,
    pub path: String,
}

pub fn folder_start(home: Option<&Path>, near: Option<&str>) -> Option<PathBuf> {
    near.map(Path::new)
        .filter(|p| p.is_absolute() && p.is_dir())
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .or_else(|| home.map(Path::to_path_buf))
}

pub fn label(n: usize) -> String {
    format!("{LABEL_PREFIX}{n}")
}

pub fn is_browse_label(label: &str) -> bool {
    label
        .strip_prefix(LABEL_PREFIX)
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

pub fn allow_navigation(target: &Url, serve: Option<&Url>) -> bool {
    if target.as_str() == "about:blank" {
        return true;
    }
    if target.scheme() != "http" && target.scheme() != "https" {
        return false;
    }
    match serve {
        Some(serve) => target.origin() != serve.origin(),
        None => true,
    }
}

pub fn address(input: &str) -> Result<Url, String> {
    let text = input.trim();
    if text.is_empty() {
        return Err("goto needs a URL".into());
    }
    let bare = text.strip_prefix(':').unwrap_or(text);
    let digits = bare.bytes().take_while(u8::is_ascii_digit).count();
    let full = if digits > 0 && (digits == bare.len() || bare.as_bytes()[digits] == b'/') {
        format!("http://127.0.0.1:{bare}")
    } else if text.contains("://") || text.starts_with("about:") {
        text.to_string()
    } else {
        format!("http://{text}")
    };
    let url = Url::parse(&full).map_err(|e| format!("goto {text}: {e}"))?;
    if !allow_navigation(&url, None) {
        return Err(format!(
            "goto {text}: only http and https pages open in the app browser"
        ));
    }
    Ok(url)
}

pub fn attach_args() -> [&'static str; 2] {
    ["browser", "attach"]
}

pub fn parse_call(line: &str) -> Result<Call, String> {
    serde_json::from_str(line).map_err(|e| format!("browser call {line:?}: {e}"))
}

pub fn reply_line(call: u64, outcome: &Result<Value, String>) -> String {
    match outcome {
        Ok(result) => json!({"call": call, "result": result}),
        Err(error) => json!({"call": call, "error": error}),
    }
    .to_string()
}

fn text_arg(args: &Value, key: &str) -> String {
    args.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn element_ref(args: &Value) -> String {
    text_arg(args, "ref").trim_start_matches('@').to_string()
}

fn script(body: &str, params: Value) -> Step {
    Step::Script {
        body: body.to_string(),
        params,
    }
}

pub fn device_size(name: &str) -> Option<(f64, f64)> {
    match name {
        "desktop" => Some((1280.0, 800.0)),
        "ipad" => Some((820.0, 1180.0)),
        "iphone" => Some((393.0, 852.0)),
        _ => None,
    }
}

pub fn plan(command: &str, args: &Value) -> Result<Step, String> {
    Ok(match command {
        "goto" => Step::Goto(address(&text_arg(args, "url"))?),
        "snapshot" => script(SNAPSHOT, json!({})),
        "click" => script(&format!("{MARK}{CLICK}"), json!({"ref": element_ref(args)})),
        "fill" => script(
            &format!("{MARK}{FILL}"),
            json!({"ref": element_ref(args), "text": text_arg(args, "text")}),
        ),
        "type" => script(TYPE, json!({"text": text_arg(args, "text")})),
        "press" => script(PRESS, json!({"key": text_arg(args, "key")})),
        "eval" => script(EVAL, json!({"js": text_arg(args, "js")})),
        "console" => script(CONSOLE, json!({})),
        "wait" => {
            if let Some(ms) = args.get("ms").and_then(Value::as_f64) {
                Step::Sleep(ms.max(0.0) as u64)
            } else if args.get("ref").is_some() {
                Step::WaitFor {
                    body: HAS_REF.to_string(),
                    params: json!({"ref": element_ref(args)}),
                }
            } else {
                Step::WaitFor {
                    body: HAS_TEXT.to_string(),
                    params: json!({"text": text_arg(args, "text")}),
                }
            }
        }
        "screenshot" => Step::Screenshot,
        "tabs" => Step::Tabs,
        "cookies" => Step::Cookies(
            args.get("domain")
                .and_then(Value::as_str)
                .map(str::to_string),
        ),
        "set-device" => {
            let name = text_arg(args, "device").to_lowercase();
            let (width, height) =
                device_size(&name).ok_or("set-device needs desktop, ipad or iphone")?;
            Step::Device {
                name,
                width,
                height,
            }
        }
        other => return Err(format!("unknown browser command {other:?}")),
    })
}

pub fn run_script(id: u64, body: &str, params: &Value) -> String {
    format!(
        "(() => {{ const store = window.__crewResults || (window.__crewResults = {{}}); \
(async ({{ref, text, key, js}}) => {{\n{body}\n}})({params}).then(\
(v) => {{ store[{id}] = {{ok: v === undefined ? null : v}}; }}, \
(e) => {{ store[{id}] = {{error: String((e && e.message) || e)}}; }}); }})();"
    )
}

pub fn read_script(id: u64) -> String {
    format!(
        "(() => {{ const store = window.__crewResults; if (!store || !({id} in store)) return null; \
const r = store[{id}]; delete store[{id}]; \
try {{ return JSON.stringify(r); }} catch (e) {{ return JSON.stringify({{error: String(e)}}); }} }})()"
    )
}

pub fn read_result(value: &str) -> Option<Result<Value, String>> {
    let first: Value = serde_json::from_str(value.trim()).ok()?;
    let doc = match first {
        Value::Null => return None,
        Value::String(inner) => serde_json::from_str(&inner).ok()?,
        other => other,
    };
    if let Some(error) = doc.get("error") {
        return Some(Err(error
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| error.to_string())));
    }
    doc.get("ok").cloned().map(Ok)
}

pub fn page_result(prefix: &str, url: &str, title: &str) -> Value {
    json!({"text": format!("{prefix}{url}"), "url": url, "title": title})
}

pub fn tabs_result(url: &str, title: &str) -> Value {
    let mut line = format!("* {url}");
    if !title.is_empty() {
        line.push_str("  ");
        line.push_str(title);
    }
    json!({"text": line, "tabs": [{"id": "1", "url": url, "title": title, "selected": true}]})
}

pub fn cookies_result(rows: &[CookieRow], domain: Option<&str>) -> Value {
    let keep: Vec<&CookieRow> = rows
        .iter()
        .filter(|c| {
            let host = c.domain.trim_start_matches('.');
            match domain {
                None | Some("") => true,
                Some(d) => {
                    host == d
                        || host.ends_with(&format!(".{d}"))
                        || d.ends_with(&format!(".{host}"))
                }
            }
        })
        .collect();
    let text = keep
        .iter()
        .map(|c| format!("{}\t{}", c.domain, c.name))
        .collect::<Vec<_>>()
        .join("\n");
    json!({
        "text": if text.is_empty() { "no cookies".to_string() } else { text },
        "cookies": keep.iter().map(|c| json!({"name": c.name, "domain": c.domain, "path": c.path})).collect::<Vec<_>>(),
    })
}

pub struct Responder {
    call: u64,
    input: Arc<Mutex<ChildStdin>>,
}

impl Responder {
    pub fn send(self, outcome: Result<Value, String>) {
        let line = reply_line(self.call, &outcome);
        let mut input = self.input.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(input, "{line}");
        let _ = input.flush();
    }
}

pub fn run_bridge(
    crew: &Path,
    handle: impl Fn(Call, Responder) + Send + Sync + 'static,
) -> io::Result<()> {
    let mut child = Command::new(crew)
        .args(attach_args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;
    let input = Arc::new(Mutex::new(
        child.stdin.take().ok_or(io::ErrorKind::BrokenPipe)?,
    ));
    let output = child.stdout.take().ok_or(io::ErrorKind::BrokenPipe)?;
    for line in BufReader::new(output).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        match parse_call(&line) {
            Ok(call) => {
                let responder = Responder {
                    call: call.call,
                    input: input.clone(),
                };
                handle(call, responder);
            }
            Err(err) => eprintln!("crew-desktop: {err}"),
        }
    }
    drop(input);
    let _ = child.wait();
    Ok(())
}
