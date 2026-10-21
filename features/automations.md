# Automations

Automations are `[[automation]]` tables in `$CREW_HOME/config.toml` or a repo's `.crew.toml`. They start sessions on demand (`a` in the TUI, `crew automation run`, the PWA) or on a schedule. With no automations, every surface says how to add one.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### CLI empty state tells how to add one

```sh
go run ./scripts/verify iso crew --expect "no automations" --expect "[[automation]]" -- automation list
```

### TUI a shows the empty state

```sh
go run ./scripts/verify tui drive --restart --out-dir /tmp/crew-verify-map/automations --steps '[{"expect":"seeded change 2","timeout":8000},{"keys":"a"},{"expect":"no automations","timeout":5000},{"shot":"empty.png"}]'
```

### PWA automations tab at both viewports

```sh
go run ./scripts/verify web drive /#/automations --viewport both --out-dir /tmp/crew-verify-map/automations --steps '[{"expect":{"role":"link","name":"Automations"}},{"shot":"tab.png"}]'
```

Expect: the empty state, no console errors, no failed API calls.

### PWA run history shows the local start time

```sh
printf '\n[[automation]]\nname = "TEST-run"\nagent = "claude"\ntarget = "workspace"\nprompt = "TEST prompt"\n' >> "$(jq -r .home "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/config.toml"
go run ./scripts/verify iso crew -- automation run TEST-run TEST-context
go run ./scripts/verify web drive /#/automations --viewport both --out-dir /tmp/crew-verify-map/automations --steps '[{"click":{"role":"button","name":"History of TEST-run"}},{"expect":{"role":"list","name":"Runs of TEST-run"}},{"shot":"history.png"}]'
```

Expect: the start time has no `UTC` suffix and matches `crew automation runs` (#467).

### PWA a skipped run shows in last run and History

```sh
printf '\n[[automation]]\nname = "TEST-skip"\nagent = "claude"\ntarget = "workspace"\nprecheck = "exit 3"\nprompt = "TEST prompt"\n' >> "$(jq -r .home "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/config.toml"
go run ./scripts/verify web drive /#/automations --viewport both --out-dir /tmp/crew-verify-map/automations --steps '[{"click":{"role":"button","name":"Run TEST-skip"}},{"click":{"role":"button","name":"Run","exact":true}},{"expect":{"text":"last run skipped","exact":false},"timeout":10000},{"click":{"role":"button","name":"History of TEST-skip"}},{"expect":{"role":"list","name":"Runs of TEST-skip"}},{"shot":"skipped.png"}]'
```

Expect: the card and History show the skipped run with no reload (#503).

### PWA details tabs and the form keep their styles

```sh
printf '\n[[automation]]\nname = "TEST-tabs"\nagent = "claude"\ntarget = "workspace"\nprompt = "TEST prompt"\n' >> "$(jq -r .home "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/config.toml"
go run ./scripts/verify web drive /#/automations --viewport both --out-dir /tmp/crew-verify-map/automations --steps '[{"click":{"role":"button","name":"Details of TEST-tabs"}},{"expect":{"role":"tab","name":"Runs"}},{"shot":"details.png"},{"click":{"role":"button","name":"New automation"}},{"expect":{"label":"Enabled"}},{"shot":"form.png"}]'
```

Expect: only the selected tab is blue, the facts show as a grid, and the form is in a panel with a small Enabled checkbox next to its label (#595).

### run an automation from config (manual: needs an [[automation]] table in the isolated config.toml and a harness that runs turns; the fake claude does not)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- A repo `.crew.toml` automation must be trusted (`crew automation trust <name>`) before it runs.
