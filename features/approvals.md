# Approvals

An approval is an action of an agent that waits for the user (`crew approval list|approve|deny`). The PWA has an Approvals tab. With none pending, each surface says so.

## Setup

```sh
go run ./scripts/verify iso down
go run ./scripts/verify iso up
go run ./scripts/verify iso seed --sessions 3
```

## Recipes

### CLI empty state

```sh
go run ./scripts/verify iso crew --expect "no pending approvals" -- approval list
```

### PWA approvals tab at both viewports

```sh
go run ./scripts/verify web drive /#/approvals --viewport both --out-dir /tmp/crew-verify-map/approvals --steps '[{"expect":{"role":"link","name":"Approvals"}},{"shot":"tab.png"}]'
```

### a help flag in the place of the ID prints the usage

```sh
{ go run ./scripts/verify iso crew -- approval approve --help || true; } | grep -q 'usage: crew approval'
{ go run ./scripts/verify iso crew -- approval deny -h || true; } | grep -q 'usage: crew approval'
{ go run ./scripts/verify iso crew -- automation show --help || true; } | grep -q 'usage: crew automation'
```

### approve a pending approval from the phone (manual: needs an agent that asks for an approval; the fake claude does not)

## Cleanup

```sh
go run ./scripts/verify iso down
```

## Gotchas

- The stream carries no approvals. The PWA list loads again when the page is shown and on the 30 s clock tick ([#533](https://github.com/giovaniif/crew/issues/533)). Only `npm test -- Approvals` proves it, because no local session can make a pending approval.
