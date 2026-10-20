use std::ffi::OsString;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};

use crew_desktop::local::{crew_name, find_crew, free_port, serve_args};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("crew-desktop-{}-{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn put_crew(dir: &Path) -> PathBuf {
    let file = dir.join(crew_name());
    fs::write(&file, b"").unwrap();
    file
}

fn path_of(dirs: &[&Path]) -> OsString {
    std::env::join_paths(dirs).unwrap()
}

#[test]
fn free_port_is_a_loopback_port_that_can_be_bound() {
    let port = free_port().unwrap();
    assert_ne!(port, 0);
    TcpListener::bind(("127.0.0.1", port)).unwrap();
}

#[test]
fn the_bundled_crew_wins_over_the_path() {
    let bundle = temp_dir("bundle");
    let on_path = temp_dir("onpath");
    let bundled = put_crew(&bundle);
    put_crew(&on_path);
    let path = path_of(&[&on_path]);
    assert_eq!(find_crew(Some(&bundle), Some(&path)), Some(bundled));
}

#[test]
fn without_a_bundled_crew_the_first_one_on_the_path_wins() {
    let bundle = temp_dir("emptybundle");
    let empty = temp_dir("emptypath");
    let first = temp_dir("first");
    let second = temp_dir("second");
    let want = put_crew(&first);
    put_crew(&second);
    let path = path_of(&[&empty, &first, &second]);
    assert_eq!(find_crew(Some(&bundle), Some(&path)), Some(want));
}

#[test]
fn no_crew_anywhere_finds_nothing() {
    let empty = temp_dir("nothing");
    let path = path_of(&[&empty]);
    assert_eq!(find_crew(None, Some(&path)), None);
    assert_eq!(find_crew(None, None), None);
}

#[test]
fn a_directory_named_crew_is_not_the_binary() {
    let dir = temp_dir("dirnamed");
    fs::create_dir_all(dir.join(crew_name())).unwrap();
    let path = path_of(&[&dir]);
    assert_eq!(find_crew(None, Some(&path)), None);
}

#[test]
fn serve_listens_on_loopback_with_the_same_public_url() {
    assert_eq!(
        serve_args(51234),
        vec!["serve", "--addr", "127.0.0.1:51234", "--url", "http://127.0.0.1:51234"]
    );
}
