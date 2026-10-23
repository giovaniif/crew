import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const driver = process.env.CREW_E2E_DRIVER ?? "http://127.0.0.1:4444";
const application = process.env.CREW_E2E_APP;
const auth = JSON.stringify({ token: "demo-token", device: { id: "d1", name: "e2e", created_at: "2026-10-20T00:00:00Z", last_seen: null } });

let session = "";

async function call(method, path, body) {
  const res = await fetch(driver + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(method + " " + path + ": " + JSON.stringify(json.value));
  }
  return json.value;
}

const run = (script, args = []) => call("POST", "/session/" + session + "/execute/sync", { script, args });

async function waitFor(check, what, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await check();
    if (last) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail("timed out waiting for " + what + ", last value " + JSON.stringify(last));
}

before(async () => {
  assert.ok(application, "CREW_E2E_APP must point at the built app");
  const created = await call("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application } } },
  });
  session = created.sessionId;
});

after(async () => {
  if (session) {
    await call("DELETE", "/session/" + session).catch(() => undefined);
  }
});

test("the app window shows the session list of the server", async () => {
  await waitFor(() => run("return document.readyState === 'complete' && location.protocol.startsWith('http')"), "the served page");
  await run("localStorage.setItem('crew.auth', arguments[0]); location.reload(); return true", [auth]);
  await waitFor(
    () => run("return !!document.querySelector('nav[aria-label=Sidebar] .side-scroll') || [...document.querySelectorAll('h1')].some((h) => h.textContent === 'Sessions')"),
    "the Sessions heading",
  );
  await waitFor(() => run("return document.body.innerText.includes('fix the login redirect')"), "a session row from the stream");
});

const runAsync = (script, args = []) => call("POST", "/session/" + session + "/execute/async", { script, args });

test("the served page can call the tray and banner commands of the app", async () => {
  const menu = {
    needsYou: [{ id: "a", name: "api", where: "api@main", permission: true }],
    doneUnread: [],
    working: [],
    meters: [{ title: "Claude 5h", caption: "40%", low: false }],
    badge: 1,
  };
  const banner = { id: "a", title: "api", body: "wants to run Bash", kind: "permission", sound: false };
  const result = await runAsync(
    "const done = arguments[arguments.length - 1];" +
      "const t = window.__TAURI_INTERNALS__;" +
      "if (!t) { done('no ipc'); return; }" +
      "t.invoke('crew_attention', { menu: arguments[0] })" +
      ".then(() => t.invoke('crew_notify', { banner: arguments[1] }))" +
      ".then(() => done('ok'), (e) => done('error: ' + String(e)));",
    [menu, banner],
  );
  assert.equal(result, "ok");
});
