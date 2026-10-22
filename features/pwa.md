# PWA

The phone app: the session list, the chat, the new session form, the Approvals, Automations and Settings tabs, and pairing. It must work at 390x844 and 1440x900, with no console errors and no failed API calls.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### session list at both viewports

```sh
go run ./scripts/verify web shot / --viewport both --out-dir /tmp/crew-verify-map/pwa
```

### tabs navigate

```sh
go run ./scripts/verify web drive / --viewport mobile --out-dir /tmp/crew-verify-map/pwa --steps '[{"click":{"role":"link","name":"Settings"}},{"expect":{"role":"link","name":"Settings"}},{"shot":"settings.png"},{"click":{"role":"link","name":"Sessions"}},{"expect":{"text":"seeded change 1"}}]'
```

### new session form

```sh
go run ./scripts/verify web drive / --viewport both --out-dir /tmp/crew-verify-map/pwa --steps '[{"click":{"role":"link","name":"New session"}},{"expect":{"text":"claude","exact":false}},{"shot":"new.png"}]'
```

### new mate takes its name from the chosen face

```sh
go run ./scripts/verify web drive '/#/mates/new' --viewport both --out-dir /tmp/crew-verify-map/pwa --steps '[{"click":{"role":"button","name":"Quill"}},{"eval":"(() => { if (document.querySelector(\"label.field input\").value !== \"quill\") throw new Error(\"name not filled\"); return 1 })()"},{"shot":"new-mate.png"}]'
```

### remove workspace confirm marks Remove as danger

```sh
rm -rf /tmp/TEST-ws && git init -q /tmp/TEST-ws && git -C /tmp/TEST-ws commit -q --allow-empty -m init
go run ./scripts/verify web drive '/#/new' --viewport both --out-dir /tmp/crew-verify-map/pwa --steps '[{"click":{"role":"button","name":"Add workspace…"}},{"fill":{"label":"Folder on the server","exact":false},"value":"/tmp/TEST-ws"},{"click":{"role":"button","name":"Add","exact":true}},{"wait":1200},{"click":{"role":"button","name":"Remove workspace"}},{"eval":"(() => { if (!document.querySelector(\".confirm button.danger\")) throw new Error(\"Remove is not danger\"); return 1 })()"},{"click":{"role":"button","name":"Remove /tmp/TEST-ws"}},{"shot":"remove-workspace.png"}]'
```

### pairing screen in the installed app with the fake API

```sh
go run ./scripts/verify web drive / --fake --installed --viewport mobile --out-dir /tmp/crew-verify-map/pwa --steps '[{"expect":{"label":"Code","exact":false}},{"shot":"pair.png"}]'
```

### dark scheme

```sh
go run ./scripts/verify web shot / --scheme dark --viewport mobile --out-dir /tmp/crew-verify-map/pwa-dark
```

### Add to Home Screen and push banners on iOS (manual: needs a real iPhone)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- `verify web` blocks the service worker, so a stale build never serves the page.
