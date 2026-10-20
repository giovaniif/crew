use crew_desktop::{start, Start};

#[test]
fn mobile_opens_the_bundled_pairing_ui() {
    assert_eq!(start(true, None).unwrap(), Start::Bundled);
}

#[test]
fn mobile_ignores_crew_url() {
    assert_eq!(start(true, Some("http://10.0.0.2:7420/".into())).unwrap(), Start::Bundled);
}

#[test]
fn desktop_opens_the_local_crew_serve() {
    assert_eq!(start(false, None).unwrap(), Start::Remote("http://127.0.0.1:7420/".parse().unwrap()));
}

#[test]
fn desktop_opens_crew_url() {
    assert_eq!(
        start(false, Some("http://10.0.0.2:7420/".into())).unwrap(),
        Start::Remote("http://10.0.0.2:7420/".parse().unwrap())
    );
}

#[test]
fn desktop_refuses_a_bad_crew_url() {
    assert!(start(false, Some("not a url".into())).is_err());
}
