use crew_desktop::attention::{action, badge, entries, Action, Entry, Menu};

fn menu(json: &str) -> Menu {
    serde_json::from_str(json).unwrap()
}

const FULL: &str = r#"{
  "needsYou": [
    {"id": "p", "name": "api", "where": "api@fix", "permission": true},
    {"id": "w", "name": "web", "where": "", "permission": false}
  ],
  "doneUnread": [{"id": "d", "name": "docs", "where": "docs@main", "permission": false}],
  "working": [{"id": "r", "name": "run", "where": "run@main", "permission": false}],
  "meters": [{"title": "Claude 5h", "caption": "70%", "low": true}],
  "badge": 2
}"#;

fn item(id: &str, text: &str) -> Entry {
    Entry::Item {
        id: id.into(),
        text: text.into(),
        enabled: true,
    }
}

fn label(text: &str) -> Entry {
    Entry::Item {
        id: String::new(),
        text: text.into(),
        enabled: false,
    }
}

#[test]
fn the_tray_lists_needs_you_done_unread_working_the_meters_and_new_session() {
    assert_eq!(
        entries(&menu(FULL)),
        vec![
            label("Needs you"),
            item("session:p", "◆ api — api@fix"),
            item("session:w", "● web"),
            Entry::Separator,
            label("Done · unread"),
            item("session:d", "✓ docs — docs@main"),
            Entry::Separator,
            label("Working"),
            item("session:r", "◌ run — run@main"),
            Entry::Separator,
            label("Claude 5h  70% (low)"),
            Entry::Separator,
            item("new", "New session…"),
            item("open", "Open crew"),
            item("quit", "Quit crew"),
        ]
    );
}

#[test]
fn an_empty_tray_says_that_nothing_needs_you() {
    let empty = menu(r#"{"needsYou":[],"doneUnread":[],"working":[],"meters":[],"badge":0}"#);
    assert_eq!(
        entries(&empty),
        vec![
            label("Nothing needs you"),
            Entry::Separator,
            item("new", "New session…"),
            item("open", "Open crew"),
            item("quit", "Quit crew"),
        ]
    );
}

#[test]
fn a_menu_item_opens_its_session_or_the_new_session_form() {
    assert_eq!(
        action("session:a/b"),
        Some(Action::Show(Some("#/sessions/a%2Fb".into())))
    );
    assert_eq!(action("new"), Some(Action::Show(Some("#/new".into()))));
    assert_eq!(action("open"), Some(Action::Show(None)));
    assert_eq!(action("quit"), Some(Action::Quit));
    assert_eq!(action("other"), None);
    assert_eq!(action("session:"), None);
}

#[test]
fn the_badge_counts_the_sessions_that_need_you_and_is_gone_at_zero() {
    assert_eq!(badge(&menu(FULL)), Some(2));
    assert_eq!(
        badge(&menu(
            r#"{"needsYou":[],"doneUnread":[],"working":[],"meters":[],"badge":0}"#
        )),
        None
    );
}
