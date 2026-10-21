use serde::Deserialize;

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Row {
    pub id: String,
    pub name: String,
    #[serde(rename = "where", default)]
    pub place: String,
    #[serde(default)]
    pub permission: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Meter {
    pub title: String,
    pub caption: String,
    #[serde(default)]
    pub low: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Menu {
    #[serde(default)]
    pub needs_you: Vec<Row>,
    #[serde(default)]
    pub done_unread: Vec<Row>,
    #[serde(default)]
    pub working: Vec<Row>,
    #[serde(default)]
    pub meters: Vec<Meter>,
    #[serde(default)]
    pub badge: i64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Banner {
    pub id: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub sound: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Entry {
    Item {
        id: String,
        text: String,
        enabled: bool,
    },
    Separator,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Show(Option<String>),
    Quit,
}

fn label(text: &str) -> Entry {
    Entry::Item {
        id: String::new(),
        text: text.into(),
        enabled: false,
    }
}

fn item(id: String, text: String) -> Entry {
    Entry::Item {
        id,
        text,
        enabled: true,
    }
}

fn row_text(glyph: &str, row: &Row) -> String {
    if row.place.is_empty() {
        format!("{glyph} {}", row.name)
    } else {
        format!("{glyph} {} — {}", row.name, row.place)
    }
}

fn section(out: &mut Vec<Entry>, title: &str, rows: &[Row], glyph: impl Fn(&Row) -> &'static str) {
    if rows.is_empty() {
        return;
    }
    out.push(label(title));
    for row in rows {
        out.push(item(
            format!("session:{}", row.id),
            row_text(glyph(row), row),
        ));
    }
    out.push(Entry::Separator);
}

pub fn entries(menu: &Menu) -> Vec<Entry> {
    let mut out = Vec::new();
    section(&mut out, "Needs you", &menu.needs_you, |r| {
        if r.permission {
            "◆"
        } else {
            "●"
        }
    });
    section(&mut out, "Done · unread", &menu.done_unread, |_| "✓");
    section(&mut out, "Working", &menu.working, |_| "◌");
    if out.is_empty() {
        out.push(label("Nothing needs you"));
        out.push(Entry::Separator);
    }
    if !menu.meters.is_empty() {
        for meter in &menu.meters {
            let low = if meter.low { " (low)" } else { "" };
            out.push(label(&format!("{}  {}{low}", meter.title, meter.caption)));
        }
        out.push(Entry::Separator);
    }
    out.push(item("new".into(), "New session…".into()));
    out.push(item("open".into(), "Open crew".into()));
    out.push(item("quit".into(), "Quit crew".into()));
    out
}

fn encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn action(id: &str) -> Option<Action> {
    match id {
        "new" => Some(Action::Show(Some("#/new".into()))),
        "open" => Some(Action::Show(None)),
        "quit" => Some(Action::Quit),
        _ => {
            let session = id.strip_prefix("session:")?;
            if session.is_empty() {
                return None;
            }
            Some(Action::Show(Some(format!(
                "#/sessions/{}",
                encode(session)
            ))))
        }
    }
}

pub fn badge(menu: &Menu) -> Option<i64> {
    let count = menu.needs_you.len() as i64;
    (count > 0).then_some(count)
}
