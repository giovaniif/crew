use std::time::Duration;

use crew_desktop::update::{answer, newer, prompt, Step, CHECK_EVERY};

#[test]
fn a_higher_version_is_newer() {
    assert!(newer("0.1.0", "0.2.0"));
    assert!(newer("0.1.0", "0.1.1"));
    assert!(!newer("0.2.0", "0.1.9"));
    assert!(!newer("0.1.0", "0.1.0"));
}

#[test]
fn prereleases_are_offered() {
    assert!(newer("0.1.0-beta.1", "0.1.0-beta.2"));
    assert!(newer("0.1.0-beta.9", "0.1.0-beta.10"));
    assert!(newer("0.1.0-alpha.3", "0.1.0-beta.1"));
    assert!(newer("0.1.0-beta.2", "0.1.0"));
    assert!(newer("0.0.9", "0.1.0-beta.1"));
    assert!(!newer("0.1.0", "0.1.0-beta.5"));
}

#[test]
fn a_leading_v_is_accepted() {
    assert!(newer("v0.1.0-beta.1", "v0.1.0-beta.2"));
    assert!(newer("0.1.0-beta.1", "v0.1.0-beta.2"));
}

#[test]
fn a_version_that_does_not_parse_is_never_newer() {
    assert!(!newer("0.1.0", "latest"));
    assert!(!newer("dev", "0.2.0"));
    assert!(!newer("0.1.0", ""));
}

#[test]
fn the_prompt_names_both_versions_and_the_daemon_restart() {
    let p = prompt("0.1.0-beta.1", "0.1.0-beta.2", None);
    assert_eq!(p.title, "crew 0.1.0-beta.2 is available");
    assert!(p.message.contains("0.1.0-beta.1"), "{}", p.message);
    assert!(p.message.contains("0.1.0-beta.2"), "{}", p.message);
    assert!(p.message.contains("crew daemon"), "{}", p.message);
    assert_eq!(p.install, "Install and restart");
    assert_eq!(p.later, "Later");
}

#[test]
fn the_prompt_shows_the_release_notes() {
    let p = prompt("0.1.0", "0.2.0", Some("  Faster review pane.  "));
    assert!(p.message.ends_with("Faster review pane."), "{}", p.message);
    let empty = prompt("0.1.0", "0.2.0", Some("   "));
    assert_eq!(empty.message, prompt("0.1.0", "0.2.0", None).message);
}

#[test]
fn later_changes_nothing() {
    assert_eq!(answer(false), Vec::<Step>::new());
}

#[test]
fn install_replaces_the_app_and_crew_then_restarts_the_daemon_and_the_app() {
    assert_eq!(
        answer(true),
        vec![Step::Install, Step::StopServe, Step::StopDaemon, Step::Restart]
    );
}

#[test]
fn the_app_checks_every_six_hours() {
    assert_eq!(CHECK_EVERY, Duration::from_secs(6 * 60 * 60));
}
