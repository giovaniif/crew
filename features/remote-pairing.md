# Remote, serve and pairing

`crew serve` is the HTTP and WebSocket API of the phone app. `crew remote pair` gives a single-use code, the phone redeems it with `POST /api/v1/pair` and gets a device token. `crew remote devices` lists devices and `crew remote revoke` removes one. `verify iso up` pairs the device `TEST-verify` this way.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
```

## Recipes

### the paired device is listed

```sh
go run ./scripts/verify iso crew --expect TEST-verify -- remote devices
```

### pair prints a link and a code

```sh
go run ./scripts/verify iso crew --expect "#pair=" --expect "single use" -- remote pair --name TEST-phone --url https://iso.invalid
```

### pair refuses an http URL

```sh
sh -c '! go run ./scripts/verify iso crew -- remote pair --url http://iso.invalid >/dev/null'
```

### the PWA signs in with the paired token

```sh
go run ./scripts/verify web drive / --viewport mobile --out-dir /tmp/crew-verify-map/remote --steps '[{"expect":{"role":"link","name":"New session"}},{"shot":"signed-in.png"}]'
```

### sign out does not keep the code of a pair link (mobile)

```sh
go run ./scripts/verify web drive "/#pair=ABCD2345" --viewport mobile --installed --out-dir /tmp/crew-verify-map/remote --steps '[{"click":{"role":"link","name":"Settings"}},{"click":{"role":"button","name":"Sign out"}},{"expect":{"role":"heading","name":"Pair this device"}},{"eval":"if (document.querySelector(\"input.code-input\").value !== \"\") throw new Error(\"stale pair code\")"}]'
```

### sign out unpairs the device on the server

```sh
sh -c '! go run ./scripts/verify iso crew -- remote devices | grep -q TEST-verify'
```

### sign out does not keep the code of a pair link (desktop, after a new pair)

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify web drive "/#pair=ABCD2345" --viewport desktop --installed --out-dir /tmp/crew-verify-map/remote --steps '[{"click":{"role":"link","name":"Settings"}},{"click":{"role":"button","name":"Sign out"}},{"expect":{"role":"heading","name":"Pair this device"}},{"eval":"if (document.querySelector(\"input.code-input\").value !== \"\") throw new Error(\"stale pair code\")"}]'
```

### Settings opens after a sign out and a new pair

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
sh -c 'C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-again --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; go run ./scripts/verify web drive / --viewport mobile --installed --out-dir /tmp/crew-verify-map/remote --steps "[{\"click\":{\"role\":\"link\",\"name\":\"Settings\"}},{\"click\":{\"role\":\"button\",\"name\":\"Sign out\"}},{\"fill\":{\"label\":\"Pairing code\"},\"value\":\"$C\"},{\"click\":{\"role\":\"button\",\"name\":\"Pair\"}},{\"wait\":2000},{\"click\":{\"role\":\"link\",\"name\":\"Settings\"}},{\"expect\":{\"role\":\"heading\",\"name\":\"Settings\"}}]"'
```

### hello answers with the API version and no token

```sh
sh -c 'curl -fsS "$(jq -r .serve_url "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/api/v1/hello" | jq -e ".api == \"v1\""'
```

### stream refuses a request with no token

```sh
sh -c 'test "$(curl -s -o /dev/null -w "%{http_code}" "$(jq -r .serve_url "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/api/v1/stream")" = 403'
```

### session options list the harnesses

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/session-options" | jq -e ".harnesses | length > 0"'
```

Expect: the JSON lists Claude Code with its models and efforts.

### workspace dirs list a folder

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/workspaces/dirs?path=/tmp" | jq -e ".dirs | type == \"array\""'
```

Expect: the JSON lists the folders in `/tmp`.

### push key gives a VAPID public key

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/push/key" | jq -e ".public_key | length > 40"'
```

Expect: a key that the PWA uses for push subscribe.

### automation runs answer with a list

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/automations/runs" | jq -e ".runs | type == \"array\""'
```

Expect: an empty list on a new isolated crew.

### work item resolve refuses an empty item

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; S="$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $T" "$U/api/v1/work-items/resolve")"; test "$S" = 400'
```

Expect: 400 with `item is required`.

### an owner device makes a pair code over HTTP

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -X POST -d "{}" -H "Authorization: Bearer $T" "$U/api/v1/pair/code" | jq -e ".code | length == 8"'
```

Expect: a single-use code and its expiry.

### a wrong push delay shows its error under Save delay

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
sh -c 'go run ./scripts/verify web drive /#/settings --viewport mobile --out-dir /tmp/crew-verify-map/remote --steps "[{\"expect\":{\"role\":\"heading\",\"name\":\"Settings\"}},{\"eval\":\"document.querySelectorAll(\\\"ul.settings-nav\\\")[1].querySelectorAll(\\\"button\\\")[2].click()\"},{\"expect\":{\"text\":\"Devices\"}},{\"fill\":{\"label\":\"Push after I am away for\"},\"value\":\"TEST-bad\"},{\"click\":{\"role\":\"button\",\"name\":\"Save delay\"}},{\"eval\":\"const a=document.querySelector(\\\"[role=alert]\\\"); const h=[...document.querySelectorAll(\\\"h3\\\")].find(e=>e.textContent===\\\"Devices\\\"); if (!a || !(a.compareDocumentPosition(h) & 4)) throw new Error(\\\"error not under Save delay\\\")\"}]" | jq -e "[.problems[].msg | test(\"400\")] | all"'
```

Expect: only the 400 of `POST /api/v1/config` is a problem. The error shows above the Devices heading.

### approvals answer over HTTP

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/approvals" | jq -e "."'
```

Expect: a JSON answer for the approvals of the isolated crew.

### devices list the paired devices over HTTP

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/devices" | jq -e "tostring | test(\"TEST-curl\")"'
```

Expect: the JSON lists the device `TEST-curl`.

### disk answers over HTTP

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/disk" | jq -e ".ports | type == \"array\""'
```

Expect: the JSON has a `ports` list.

### mates answer over HTTP

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/mates" | jq -e "."'
```

Expect: a JSON answer for the mates of the isolated crew.

### onboarding answers over HTTP

```sh
sh -c 'U="$(jq -r .serve_url "$VERIFY_HOME/iso.json")"; C="$(go run ./scripts/verify iso crew -- remote pair --name TEST-curl --url https://iso.invalid 2>&1 | grep -oE "\b[A-Z0-9]{8}\b" | head -1)"; T="$(curl -fsS -X POST -d "{\"code\":\"$C\",\"name\":\"TEST-curl\"}" "$U/api/v1/pair" | jq -r .token)"; curl -fsS -H "Authorization: Bearer $T" "$U/api/v1/onboarding" | jq -e "."'
```

Expect: a JSON answer for the onboarding steps.

### mates create, claim, memory, new, pause, resume and tokens over HTTP (manual: a mate starts a real harness)

### approvals approve and deny over HTTP (manual: needs a pending approval from a real agent)

### onboarding install, remove, nvim and finish over HTTP (manual: they change the setup of the harnesses)

### session create, messages, answer, end, fresh, mute, read, shell, nvim and review over HTTP (manual: no CLI prints a session id for a curl recipe)

### terminal, browser and cookies over HTTP (manual: needs a live pane or a browser of a session)

### cleanup worktree, ports kill and workspaces remove over HTTP (manual: they remove data or stop processes)

### push subscribe and unsubscribe (manual: needs a real browser push subscription)

### session rename, switch, resume, interrupt and kill dev servers over HTTP (manual: no CLI prints a session id for a curl recipe)

### review viewed and hunk over HTTP (manual: no CLI prints a session id for a curl recipe)

### automation run rerun over HTTP (manual: needs a finished run, and a run starts a real agent)

### mates stop over HTTP (manual: needs a running mate with a real harness)

### scan the QR code with a phone camera (manual: no camera on the server)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Sign out revokes the device (#537). After a recipe signs out, the paired `TEST-verify` token no longer works. Run `iso down` and `iso up` to pair again.
- `crew serve` checks `Origin` against `--url`. `iso up` passes the Vite URL as `--url`, because the PWA runs on the Vite dev server.
- The HTTP recipes pair a `TEST-curl` device with `remote pair` and `POST /api/v1/pair`, then use its token. `iso.json` does not keep the token of `TEST-verify`.
