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

### hello answers with the API version and no token

```sh
sh -c 'curl -fsS "$(jq -r .serve_url "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/api/v1/hello" | jq -e ".api == \"v1\""'
```

### stream refuses a request with no token

```sh
sh -c 'test "$(curl -s -o /dev/null -w "%{http_code}" "$(jq -r .serve_url "${VERIFY_HOME:-/tmp/crew-verify-$(id -u)}/iso.json")/api/v1/stream")" = 403'
```

### scan the QR code with a phone camera (manual: no camera on the server)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- Sign out revokes the device (#537). After a recipe signs out, the paired `TEST-verify` token no longer works. Run `iso down` and `iso up` to pair again.
- `crew serve` checks `Origin` against `--url`. `iso up` passes the Vite URL as `--url`, because the PWA runs on the Vite dev server.
