import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";

const driver = process.env.CREW_E2E_DRIVER ?? "http://127.0.0.1:4444";
const application = process.env.CREW_E2E_APP;

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

async function waitFor(check, what, timeout = 60000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await check().catch((err) => String(err));
    if (last === true) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail("timed out waiting for " + what + ", last value " + JSON.stringify(last));
}

before(async () => {
  assert.ok(application, "CREW_E2E_APP must point at the built app");
  assert.equal(process.env.CREW_URL, undefined, "the local serve test must run without CREW_URL");
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

test("the app starts its own crew serve, pairs and shows the session list", async () => {
  await waitFor(() => run("return location.hostname === '127.0.0.1' && location.port !== '7420'"), "the page of the local crew serve");
  await waitFor(
    () => run("return !!document.querySelector('nav[aria-label=Sidebar] .side-scroll') || [...document.querySelectorAll('h1')].some((h) => h.textContent === 'Sessions')"),
    "the Sessions heading",
  );
  assert.equal(await run("return document.body.innerText.includes('Add crew to your Home Screen')"), false);
  assert.equal(await run("return localStorage.getItem('crew.auth')"), null);
  const hello = await run("return fetch('/api/v1/hello').then((r) => r.json())");
  assert.equal(hello.api, "v1");
  if (process.env.CREW_E2E_SHOTS) {
    const png = await call("GET", "/session/" + session + "/screenshot");
    await writeFile(join(process.env.CREW_E2E_SHOTS, "local-serve.png"), Buffer.from(png, "base64"));
  }
});
