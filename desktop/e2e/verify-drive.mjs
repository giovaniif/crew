import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const req = JSON.parse(readFileSync(0, "utf8"));
const res = { shots: [], eval: [] };
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
let session = "";

async function call(method, path, body) {
  const r = await fetch(req.driver + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    const why = [json.value?.error, json.value?.message?.split("\n")[0]].filter(Boolean).join(": ");
    throw new Error(method + " " + path.replace(/^\/session\/[^/]+/, "") + " " + r.status + (why ? ": " + why : ""));
  }
  return json.value;
}

const s = (path) => "/session/" + session + path;
const run = (script, args = []) => call("POST", s("/execute/sync"), { script, args });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const finder = `
const loc = arguments[0];
const exact = loc.exact ?? true;
const norm = (t) => (t ?? "").replace(/\\s+/g, " ").trim();
const match = (t) => (exact ? norm(t) === loc[loc.text !== undefined ? "text" : "name"] : norm(t).includes(loc.text ?? loc.name ?? ""));
const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
const roles = {
  button: "button, [role=button], input[type=button], input[type=submit]",
  tab: "[role=tab]",
  textbox: "textarea, input:not([type]), input[type=text], input[type=search], input[type=email], input[type=url], [role=textbox]",
  link: "a[href], [role=link]",
  navigation: "nav, [role=navigation]",
  heading: "h1, h2, h3, h4, h5, h6, [role=heading]",
  checkbox: "input[type=checkbox], [role=checkbox]",
  dialog: "dialog, [role=dialog]",
  log: "[role=log]",
  alert: "[role=alert]",
  tabpanel: "[role=tabpanel]",
};
const labelOf = (el) => {
  if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
  const by = el.getAttribute("aria-labelledby");
  if (by) return by.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  if (el.labels && el.labels.length) return [...el.labels].map((l) => l.textContent).join(" ");
  return "";
};
const nameOf = (el) => labelOf(el) || el.getAttribute("title") || el.value || el.textContent;
let all = [];
if (loc.role) {
  all = [...document.querySelectorAll(roles[loc.role] ?? "[role=" + loc.role + "]")].filter((el) => match(nameOf(el)));
} else if (loc.testId) {
  all = [...document.querySelectorAll("[data-testid='" + loc.testId + "']")];
} else if (loc.label) {
  all = [...document.querySelectorAll("input, textarea, select, [aria-label], [aria-labelledby]")].filter((el) => {
    const t = labelOf(el);
    return exact ? norm(t) === loc.label : norm(t).includes(loc.label);
  });
} else if (loc.placeholder) {
  all = [...document.querySelectorAll("[placeholder]")].filter((el) => {
    const t = el.getAttribute("placeholder");
    return exact ? norm(t) === loc.placeholder : norm(t).includes(loc.placeholder);
  });
} else {
  const hits = [...document.body.querySelectorAll("*")].filter((el) => !["SCRIPT", "STYLE"].includes(el.tagName) && match(el.innerText ?? el.textContent));
  all = hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
}
return all.find(visible) ?? null;
`;

function describe(loc) {
  return Object.entries(loc)
    .map(([k, v]) => k + "=" + String(v))
    .join(" ");
}

async function find(loc, timeout, absent = false) {
  const end = Date.now() + timeout;
  for (;;) {
    const el = await run(finder, [loc]);
    if (absent ? !el : el) {
      return el;
    }
    if (Date.now() > end) {
      throw new Error((absent ? "still visible: " : "no visible match for ") + describe(loc));
    }
    await sleep(200);
  }
}

const keys = {
  Enter: "",
  Shift: "",
  Control: "",
  Alt: "",
  Meta: "",
  Escape: "",
  Tab: "",
  Backspace: "",
  Space: " ",
  ArrowUp: "",
  ArrowDown: "",
  ArrowLeft: "",
  ArrowRight: "",
};

async function press(combo) {
  const parts = combo.split("+").map((k) => keys[k] ?? k);
  const down = parts.map((value) => ({ type: "keyDown", value }));
  const up = [...parts].reverse().map((value) => ({ type: "keyUp", value }));
  await call("POST", s("/actions"), { actions: [{ type: "key", id: "keys", actions: [...down, ...up] }] });
  await call("DELETE", s("/actions"));
}

async function shot(name) {
  const path = join(req.out_dir, "app-" + name);
  writeFileSync(path, Buffer.from(await call("GET", s("/screenshot")), "base64"));
  return path;
}

async function served() {
  const end = Date.now() + 60000;
  let last = "";
  while (Date.now() < end) {
    last = await run("return document.readyState + ' ' + location.href").catch((e) => String(e));
    if (last.startsWith("complete http://127.0.0.1:") || last.startsWith("complete http://localhost:")) {
      return;
    }
    await sleep(250);
  }
  const text = await run("return document.body ? document.body.innerText : ''").catch(() => "");
  throw new Error("the app did not open the page of its crew serve (" + last + "): " + text.replace(/\s+/g, " ").slice(0, 300));
}

async function step(st) {
  const timeout = st.timeout ?? 5000;
  if (st.goto !== undefined) {
    await served();
    await run("location.assign(new URL(arguments[0], location.origin).href); return true", [st.goto]);
    await sleep(300);
    await served();
  } else if (st.click) {
    const el = await find(st.click, timeout);
    await call("POST", s("/element/" + el[ELEMENT] + "/click"), {});
  } else if (st.fill) {
    const el = await find(st.fill, timeout);
    await call("POST", s("/element/" + el[ELEMENT] + "/clear"), {});
    await call("POST", s("/element/" + el[ELEMENT] + "/value"), { text: st.value ?? "" });
  } else if (st.press !== undefined) {
    await press(st.press);
  } else if (st.wait !== undefined) {
    await sleep(st.wait);
  } else if (st.expect) {
    await find(st.expect, timeout, st.absent);
  } else if (st.shot !== undefined) {
    res.shots.push({ path: await shot(st.shot), viewport: "app" });
  } else if (st.aria !== undefined) {
    const path = join(req.out_dir, "app-" + st.aria);
    writeFileSync(path, await run("return document.body.innerText"));
  } else if (st.eval !== undefined) {
    res.eval.push(await run("return eval(arguments[0]) ?? null", [st.eval]));
  }
  await sleep(req.settle_ms);
}

mkdirSync(req.out_dir, { recursive: true });
try {
  const created = await call("POST", "/session", {
    capabilities: { alwaysMatch: { browserName: "wry", "tauri:options": { application: req.app } } },
  });
  session = created.sessionId;
  await call("POST", s("/window/rect"), { width: req.width, height: req.height }).catch(() => undefined);
  for (const [i, st] of req.steps.entries()) {
    try {
      await step(st);
    } catch (e) {
      res.error = "app: step " + i + ": " + (e instanceof Error ? e.message : String(e));
      res.failed_step = i;
      res.failure = await shot("failure.png").catch(() => undefined);
      const text = await run("return document.body ? document.body.innerText : ''").catch(() => "");
      writeFileSync(join(req.out_dir, "app-failure.txt"), text);
      break;
    }
  }
} catch (e) {
  res.error = e instanceof Error ? e.message : String(e);
} finally {
  if (session) {
    await call("DELETE", "/session/" + session).catch(() => undefined);
  }
}
process.stdout.write(JSON.stringify(res) + "\n");
process.exitCode = res.error ? 1 : 0;
