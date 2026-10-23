# Automations

Automations are `[[automation]]` tables in `$CREW_HOME/config.toml` or a repo's `.crew.toml`. They start sessions on demand (`crew automation run`, the app) or on a schedule. With no automations, every surface says how to add one.

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

### PWA shows config problems

```sh
printf '\n[[automation]]\nname = "TEST-bad"\nagent = "nope"\ntarget = "workspace"\nprompt = "TEST prompt"\n' >> "$(jq -r .home "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/config.toml"
go run ./scripts/verify web drive /#/automations --viewport both --out-dir /tmp/crew-verify-map/automations --steps '[{"expect":{"text":"agent must be one of","exact":false}},{"shot":"problems.png"}]'
```

Expect: the problem of `TEST-bad` shows above the list, as `crew automation list` prints it (#647).

### PWA New automation refuses the name of an automation that exists

```sh
printf '\n[[automation]]\nname = "test-taken"\nagent = "claude"\ntarget = "workspace"\nprompt = "TEST original prompt"\n' >> "$(jq -r .home "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/config.toml"
go run ./scripts/verify web drive /#/automations --viewport both --out-dir /tmp/crew-verify-map/automations --steps '[{"click":{"role":"button","name":"New automation"}},{"fill":{"label":"Name"},"value":"test-taken"},{"fill":{"label":"Prompt"},"value":"TEST new prompt"},{"expect":{"text":"An automation named test-taken exists."}},{"shot":"new-taken.png"}]'
```

Expect: Save stays disabled, so the existing automation keeps its prompt ([#693](https://github.com/giovaniif/crew/issues/693)).

### PWA Edit keeps the browser and filter of an automation

```sh
H="$(jq -r .home "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")"
printf '\n[[automation]]\nname = "test-filtered"\nagent = "claude"\ntarget = "workspace"\nbrowser = "headless"\non = ["pr.opened"]\nprompt = "TEST filtered"\n[automation.filter]\nbranch = "feat/*"\n' >> "$H/config.toml"
go run ./scripts/verify web drive /#/automations --viewport desktop --out-dir /tmp/crew-verify-map/automations --steps '[{"click":{"role":"button","name":"Details of test-filtered"}},{"click":{"role":"button","name":"Edit"}},{"fill":{"role":"textbox","name":"Prompt"},"value":"TEST filtered edited"},{"click":{"role":"button","name":"Save"}},{"expect":{"text":"TEST filtered edited"}},{"shot":"edit-kept.png"}]'
grep -q 'browser = "headless"' "$H/config.toml" && grep -q 'branch = "feat/\*"' "$H/config.toml"
```

Expect: config.toml keeps `browser` and the `[automation.filter]` table ([#696](https://github.com/giovaniif/crew/issues/696)).

### run an automation from config (manual: needs an [[automation]] table in the isolated config.toml and a harness that runs turns; the fake claude does not)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- A repo `.crew.toml` automation must be trusted (`crew automation trust <name>`) before it runs.
