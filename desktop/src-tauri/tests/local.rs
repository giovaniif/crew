use std::ffi::{OsStr, OsString};
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crew_desktop::local::{crew_name, find_crew, free_port, login_path, serve_args, serve_path};

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
        vec![
            "serve",
            "--addr",
            "127.0.0.1:51234",
            "--url",
            "http://127.0.0.1:51234"
        ]
    );
}

fn dirs_of(path: &OsString) -> Vec<PathBuf> {
    std::env::split_paths(path).collect()
}

#[test]
fn serve_path_adds_the_homebrew_and_local_dirs_to_a_minimal_gui_path() {
    let path = serve_path(Some(OsStr::new("/usr/bin:/bin")), None, Some(Path::new("/Users/u")));
    let dirs = dirs_of(&path);
    for want in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/Users/u/.local/bin"] {
        assert!(dirs.contains(&PathBuf::from(want)), "{want} not in {dirs:?}");
    }
}

#[test]
fn serve_path_puts_the_login_shell_path_first_and_keeps_each_dir_once() {
    let path = serve_path(
        Some(OsStr::new("/usr/bin:/bin")),
        Some("/opt/homebrew/bin:/usr/bin".to_string()),
        None,
    );
    let dirs = dirs_of(&path);
    assert_eq!(dirs[0], PathBuf::from("/opt/homebrew/bin"));
    assert_eq!(dirs.iter().filter(|d| d.as_path() == Path::new("/usr/bin")).count(), 1);
    assert_eq!(dirs.iter().filter(|d| d.as_path() == Path::new("/opt/homebrew/bin")).count(), 1);
}

#[cfg(unix)]
fn fake_shell(name: &str, script: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let shell = temp_dir(name).join("fake-shell");
    fs::write(&shell, script).unwrap();
    fs::set_permissions(&shell, fs::Permissions::from_mode(0o755)).unwrap();
    shell
}

#[cfg(unix)]
#[test]
fn login_path_reads_the_path_that_the_shell_prints() {
    let shell = fake_shell("login-shell", "#!/bin/sh\nprintf %s /opt/homebrew/bin:/usr/bin\n");
    assert_eq!(
        login_path(&shell, Duration::from_secs(5)).as_deref(),
        Some("/opt/homebrew/bin:/usr/bin")
    );
}

#[cfg(unix)]
#[test]
fn login_path_gives_up_on_a_shell_that_hangs() {
    let shell = fake_shell("login-hang", "#!/bin/sh\nexec sleep 30\n");
    let start = Instant::now();
    assert_eq!(login_path(&shell, Duration::from_millis(300)), None);
    assert!(start.elapsed() < Duration::from_secs(5));
}
