use crew_desktop::browse::{
    address, allow_navigation, attach_args, cookies_result, is_browse_label, label, page_result,
    parse_call, plan, read_result, read_script, reply_line, run_script, CookieRow, Step,
    INIT_SCRIPT,
};
use serde_json::{json, Value};
use url::Url;

fn url(text: &str) -> Url {
    Url::parse(text).unwrap()
}

#[test]
fn each_browser_window_has_a_browse_label_and_never_a_main_label() {
    assert_eq!(label(0), "browse-0");
    assert_eq!(label(12), "browse-12");
    assert!(is_browse_label("browse-3"));
    assert!(!is_browse_label("main"));
    assert!(!is_browse_label("main-browse-3"));
    assert!(!label(4).starts_with("main"));
}

#[test]
fn the_page_can_open_http_and_https_pages() {
    let serve = url("http://127.0.0.1:53412/");
    for target in [
        "http://127.0.0.1:3000/login",
        "http://localhost:5173/",
        "https://example.com/a?b=c",
        "http://127.0.0.1:53413/",
    ] {
        assert!(allow_navigation(&url(target), Some(&serve)), "{target}");
    }
}

#[test]
fn the_page_cannot_open_the_origin_of_crew_serve() {
    let serve = url("http://127.0.0.1:53412/");
    assert!(!allow_navigation(&url("http://127.0.0.1:53412/#/sessions/s1"), Some(&serve)));
    assert!(!allow_navigation(&url("http://127.0.0.1:53412/api/v1/hello"), Some(&serve)));
}

#[test]
fn the_page_cannot_open_other_schemes() {
    for target in [
        "tauri://localhost/index.html",
        "file:///etc/passwd",
        "javascript:alert(1)",
        "ipc://localhost/fix_daemon",
        "data:text/html,hi",
    ] {
        assert!(!allow_navigation(&url(target), None), "{target}");
    }
    assert!(allow_navigation(&url("about:blank"), None));
}

#[test]
fn an_address_becomes_a_url_like_the_headless_browser() {
    assert_eq!(address("3000").unwrap().as_str(), "http://127.0.0.1:3000/");
    assert_eq!(address(":3000/login").unwrap().as_str(), "http://127.0.0.1:3000/login");
    assert_eq!(address("localhost:5173/a").unwrap().as_str(), "http://localhost:5173/a");
    assert_eq!(address("https://example.com/").unwrap().as_str(), "https://example.com/");
    assert_eq!(address("example.com").unwrap().as_str(), "http://example.com/");
    assert!(address("").is_err());
    assert!(address("ftp://example.com/").is_err());
}

#[test]
fn the_app_attaches_with_crew_browser_attach() {
    assert_eq!(attach_args(), ["browser", "attach"]);
}

#[test]
fn a_call_line_parses() {
    let call = parse_call(r#"{"call":7,"session":"s1","command":"click","args":{"ref":"@e2"}}"#)
        .unwrap();
    assert_eq!(call.call, 7);
    assert_eq!(call.session, "s1");
    assert_eq!(call.command, "click");
    assert_eq!(call.args, json!({"ref": "@e2"}));
    assert!(parse_call("not json").is_err());
}

#[test]
fn a_reply_is_one_json_line_with_the_result_or_the_error() {
    let ok: Value = serde_json::from_str(&reply_line(7, &Ok(json!({"text": "hi"})))).unwrap();
    assert_eq!(ok, json!({"call": 7, "result": {"text": "hi"}}));
    let err: Value = serde_json::from_str(&reply_line(8, &Err("no element @e9".into()))).unwrap();
    assert_eq!(err, json!({"call": 8, "error": "no element @e9"}));
    assert!(!reply_line(9, &Ok(json!("a\nb"))).contains('\n'));
}

#[test]
fn each_verb_of_the_headless_browser_has_a_step() {
    let cases = [
        ("goto", json!({"url": "3000"})),
        ("snapshot", json!({})),
        ("click", json!({"ref": "@e1"})),
        ("fill", json!({"ref": "@e1", "text": "a"})),
        ("type", json!({"text": "a"})),
        ("press", json!({"key": "Enter"})),
        ("wait", json!({"ms": 10})),
        ("wait", json!({"ref": "@e1"})),
        ("wait", json!({"text": "Signed in"})),
        ("screenshot", json!({})),
        ("eval", json!({"js": "1 + 1"})),
        ("tabs", json!({})),
        ("cookies", json!({})),
        ("set-device", json!({"device": "iphone"})),
        ("console", json!({})),
    ];
    for (command, args) in cases {
        assert!(plan(command, &args).is_ok(), "{command}");
    }
    assert!(plan("fly", &json!({})).is_err());
}

#[test]
fn goto_opens_the_address_and_set_device_resizes_the_window() {
    assert_eq!(
        plan("goto", &json!({"url": "3000/login"})).unwrap(),
        Step::Goto(url("http://127.0.0.1:3000/login"))
    );
    assert!(plan("goto", &json!({"url": "file:///etc/passwd"})).is_err());
    assert_eq!(
        plan("set-device", &json!({"device": "iphone"})).unwrap(),
        Step::Device {
            name: "iphone".into(),
            width: 393.0,
            height: 852.0
        }
    );
    assert!(plan("set-device", &json!({"device": "tv"})).is_err());
    assert_eq!(plan("wait", &json!({"ms": 250})).unwrap(), Step::Sleep(250));
    assert_eq!(
        plan("cookies", &json!({"domain": "example.com"})).unwrap(),
        Step::Cookies(Some("example.com".into()))
    );
}

#[test]
fn click_and_fill_drop_the_at_sign_of_the_ref_and_mark_the_element() {
    match plan("click", &json!({"ref": "@e4"})).unwrap() {
        Step::Script { body, params } => {
            assert_eq!(params["ref"], "e4");
            assert!(body.contains("data-crew-ref"));
            assert!(body.contains("outline"));
        }
        other => panic!("{other:?}"),
    }
    match plan("fill", &json!({"ref": "@e5", "text": "hi"})).unwrap() {
        Step::Script { params, .. } => {
            assert_eq!(params["ref"], "e5");
            assert_eq!(params["text"], "hi");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn wait_for_a_ref_or_a_text_polls_a_check() {
    match plan("wait", &json!({"ref": "@e2"})).unwrap() {
        Step::WaitFor { params, .. } => assert_eq!(params["ref"], "e2"),
        other => panic!("{other:?}"),
    }
    match plan("wait", &json!({"text": "Done"})).unwrap() {
        Step::WaitFor { params, .. } => assert_eq!(params["text"], "Done"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn a_script_writes_its_result_into_the_page_for_its_call() {
    let js = run_script(42, "return ref;", &json!({"ref": "e1"}));
    assert!(js.contains("__crewResults"));
    assert!(js.contains("42"));
    assert!(js.contains(r#"{"ref":"e1"}"#));
    assert!(js.contains("async"));
    let read = read_script(42);
    assert!(read.contains("__crewResults"));
    assert!(read.contains("42"));
}

#[test]
fn the_result_of_a_script_is_read_from_the_value_of_the_callback() {
    assert_eq!(read_result("null"), None);
    assert_eq!(read_result(""), None);
    assert_eq!(
        read_result(r#""{\"ok\":{\"text\":\"- button\"}}""#),
        Some(Ok(json!({"text": "- button"})))
    );
    assert_eq!(read_result(r#"{"ok":3}"#), Some(Ok(json!(3))));
    assert_eq!(
        read_result(r#""{\"error\":\"no element @e9: take a new snapshot\"}""#),
        Some(Err("no element @e9: take a new snapshot".into()))
    );
}

#[test]
fn the_init_script_keeps_the_last_console_lines_and_no_ipc() {
    assert!(INIT_SCRIPT.contains("__crewConsole"));
    assert!(INIT_SCRIPT.contains("200"));
    assert!(!INIT_SCRIPT.contains("__TAURI"));
    match plan("console", &json!({})).unwrap() {
        Step::Script { body, .. } => assert!(body.contains("__crewConsole")),
        other => panic!("{other:?}"),
    }
}

#[test]
fn goto_and_tabs_give_the_url_and_the_title() {
    assert_eq!(
        page_result("opened ", "http://127.0.0.1:3000/", "api"),
        json!({"text": "opened http://127.0.0.1:3000/", "url": "http://127.0.0.1:3000/", "title": "api"})
    );
}

#[test]
fn cookies_keep_the_domain_and_its_subdomains() {
    let rows = vec![
        CookieRow {
            name: "sid".into(),
            domain: ".example.com".into(),
            path: "/".into(),
        },
        CookieRow {
            name: "a".into(),
            domain: "other.org".into(),
            path: "/".into(),
        },
    ];
    let all = cookies_result(&rows, None);
    assert_eq!(all["cookies"].as_array().unwrap().len(), 2);
    let some = cookies_result(&rows, Some("app.example.com"));
    assert_eq!(some["text"], ".example.com\tsid");
    assert_eq!(cookies_result(&[], None)["text"], "no cookies");
}

#[cfg(unix)]
mod bridge {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::mpsc;

    use crew_desktop::browse::run_bridge;
    use serde_json::{json, Value};

    #[test]
    fn the_bridge_runs_each_call_and_writes_its_reply_to_crew() {
        let dir = std::env::temp_dir().join(format!("crew-desktop-bridge-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let args = dir.join("args.log");
        let reply = dir.join("reply.log");
        let script = format!(
            "#!/bin/sh\necho \"$*\" > '{args}'\necho '{{\"call\":7,\"session\":\"s1\",\"command\":\"snapshot\",\"args\":{{}}}}'\nread line\necho \"$line\" > '{reply}'\n",
            args = args.display(),
            reply = reply.display(),
        );
        let crew = dir.join("crew");
        let draft = dir.join("crew.draft");
        fs::write(&draft, script).unwrap();
        fs::set_permissions(&draft, fs::Permissions::from_mode(0o755)).unwrap();
        fs::rename(&draft, &crew).unwrap();
        let (tx, rx) = mpsc::channel();
        run_bridge(&crew, move |call, responder| {
            tx.send((call.session.clone(), call.command.clone())).unwrap();
            responder.send(Ok(json!({"text": "- button \"Go\" [@e1]"})));
        })
        .unwrap();
        assert_eq!(rx.recv().unwrap(), ("s1".to_string(), "snapshot".to_string()));
        assert_eq!(fs::read_to_string(&args).unwrap().trim(), "browser attach");
        let line: Value = serde_json::from_str(fs::read_to_string(&reply).unwrap().trim()).unwrap();
        assert_eq!(line, json!({"call": 7, "result": {"text": "- button \"Go\" [@e1]"}}));
    }
}
