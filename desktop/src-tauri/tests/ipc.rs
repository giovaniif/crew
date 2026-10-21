use crew_desktop::ipc::serve_capability;
use serde_json::{json, Value};
use url::Url;

fn capability(url: &str) -> Option<Value> {
    serve_capability(&Url::parse(url).unwrap()).map(|text| serde_json::from_str(&text).unwrap())
}

#[test]
fn the_serve_origin_gets_the_commands_and_nothing_more() {
    let cap = capability("http://127.0.0.1:53412/#/sessions/s1").unwrap();
    assert_eq!(cap["windows"], json!(["main", "main-*"]));
    assert_eq!(cap["remote"]["urls"], json!(["http://127.0.0.1:53412"]));
    assert_eq!(
        cap["permissions"],
        json!(["core:default", "allow-crew-notify", "allow-crew-attention", "allow-fix-daemon"])
    );
}

#[test]
fn localhost_keeps_its_name_and_port() {
    let cap = capability("http://localhost:5179/").unwrap();
    assert_eq!(cap["remote"]["urls"], json!(["http://localhost:5179"]));
}

#[test]
fn a_new_serve_port_gets_its_own_capability() {
    let first = capability("http://127.0.0.1:53412/").unwrap();
    let second = capability("http://127.0.0.1:53413/").unwrap();
    assert_ne!(first["identifier"], second["identifier"]);
}

#[test]
fn other_origins_get_no_ipc() {
    for url in [
        "https://crew.example.ts.net/",
        "http://crew.example.ts.net:7420/",
        "https://127.0.0.1:7420/",
        "http://192.168.1.4:7420/",
        "http://127.0.0.1/",
    ] {
        assert_eq!(capability(url), None, "{url}");
    }
}

#[test]
fn the_static_capability_gives_no_remote_origin_ipc() {
    let text = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/capabilities/default.json"
    ))
    .unwrap();
    let cap: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(cap.get("remote"), None);
    assert_eq!(cap["permissions"], json!(["core:default", "allow-fix-daemon"]));
}
