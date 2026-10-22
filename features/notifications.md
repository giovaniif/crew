# Notifications

The daemon sends a banner when a session needs the user. `crew notify stream` prints banners as JSON lines. The bridge posts them on the Mac. In the isolated crew, `terminal-notifier` and `osascript` are the e2e fakes, so nothing shows on a desktop.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### m mutes the selected session

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/notify --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"m"},{"wait":800},{"shot":"muted.png"}]'
```

### the PWA marks a muted session (#616)

```sh
go run ./scripts/verify web drive '/#/sessions/seed-session-3' --viewport desktop --out-dir /tmp/crew-verify-map/notify --steps '[{"click":{"role":"button","name":"Session commands"}},{"click":{"role":"menuitem","name":"Mute"}},{"wait":800}]'
go run ./scripts/verify web drive / --viewport both --out-dir /tmp/crew-verify-map/notify --steps '[{"expect":{"text":"muted","exact":true}},{"shot":"muted-pwa.png"}]'
```

### banner on the Mac and push on the phone (manual: needs the Mac bridge or a real phone; the isolated crew has no desktop)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- The TUI recipe mutes `seed-session-2`. The PWA recipe uses `seed-session-3`, so it starts from an unmuted session.
- `crew notify stream` runs until it is stopped. Do not run it in a recipe without a timeout.
