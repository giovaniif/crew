import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { AppEnv } from "../App";
import { browserAddress, portLinks, tabLabel } from "../browser";
import type { DesktopBridge } from "../desktopBridge";
import type { Worktree } from "../stream";
import { desktop, goldenState } from "../test/desktop";
import type { FakeServer } from "../test/fake-server";

afterEach(() => {
  window.location.hash = "";
});

const host = "crew.example.ts.net";

describe("the address rules", () => {
  it.each([
    ["3000", "http://crew.example.ts.net:3000/"],
    [":5173", "http://crew.example.ts.net:5173/"],
    ["  8080  ", "http://crew.example.ts.net:8080/"],
    ["localhost:3000/login", "http://crew.example.ts.net:3000/login"],
    ["127.0.0.1:4000", "http://crew.example.ts.net:4000/"],
    ["0.0.0.0", "http://crew.example.ts.net/"],
    ["LOCALHOST:3000", "http://crew.example.ts.net:3000/"],
    ["http://example.com/a?b=1", "http://example.com/a?b=1"],
    ["https://example.com", "https://example.com"],
    ["example.com/docs", "https://example.com/docs"],
  ])("opens %j as %s", (input, url) => {
    expect(browserAddress(input, host)).toBe(url);
  });

  it.each(["", "   ", "0", "65536", "two words", "ftp://example.com", "javascript:alert(1)", "file:///etc/passwd", "http://", "localhost:abc", "localhost:70000", "example", ".example.com", "example.com."])(
    "refuses %j",
    (input) => {
      expect(browserAddress(input, host)).toBeNull();
    },
  );
});

describe("the port links", () => {
  const worktree = (id: string, session: string, repo: string, ports: number[]): Worktree => ({
    ...goldenState().worktrees[0],
    ID: id,
    SessionID: session,
    Repo: repo,
    Ports: ports.map((p) => ({ Port: p, PID: 1, PGID: 1, Command: "node" })),
  });

  it("lists each port of the session worktrees one time, sorted", () => {
    const links = portLinks("s1", [worktree("w1", "s1", "web", [5173, 3000]), worktree("w2", "s1", "api", [3000, 8080]), worktree("w3", "s2", "docs", [4000])], host);
    expect(links).toEqual([
      { port: 3000, title: "web :3000", url: "http://crew.example.ts.net:3000/" },
      { port: 5173, title: "web :5173", url: "http://crew.example.ts.net:5173/" },
      { port: 8080, title: "api :8080", url: "http://crew.example.ts.net:8080/" },
    ]);
  });

  it("lists no ports when the worktrees have none", () => {
    expect(portLinks("s1", [{ ...goldenState().worktrees[0], Ports: null }], host)).toEqual([]);
  });
});

describe("the tab label", () => {
  it.each([
    ["", "New tab"],
    ["http://crew.example.ts.net:3000/", "crew.example.ts.net:3000"],
    ["https://example.com/docs", "example.com"],
  ])("labels %j as %s", (url, label) => {
    expect(tabLabel(url)).toBe(label);
  });
});

function withPorts(ports: number[]) {
  const state = goldenState();
  state.worktrees = state.worktrees.map((w) => ({ ...w, Ports: ports.map((p) => ({ Port: p, PID: 1, PGID: 1, Command: "node" })) }));
  return state;
}

const notLive = (server: FakeServer) => {
  server.on("GET", "/api/v1/sessions/s1/browser", { status: 200, body: { live: false } });
};

type Invoked = { cmd: string; args?: Record<string, unknown> };

function fakeApp(answer: (cmd: string) => Promise<unknown> = () => Promise.resolve(null)) {
  const calls: Invoked[] = [];
  const bridge: DesktopBridge = {
    invoke: (cmd, args) => {
      calls.push({ cmd, args });
      return answer(cmd);
    },
    focused: () => true,
    onFocusChange: () => () => undefined,
  };
  return { bridge, calls };
}

async function openBrowser(ports: number[], routes: (server: FakeServer) => void = notLive, extra: Partial<AppEnv> = {}) {
  const { live, server } = desktop("#/sessions/s1", true, undefined, extra, routes);
  live(withPorts(ports));
  await userEvent.click(await screen.findByRole("tab", { name: "Browser" }));
  return { pane: screen.getByRole("tabpanel"), server };
}

describe("the Browser tab", () => {
  it("needs a session", () => {
    const { live } = desktop();
    live();
    const tab = screen.getByRole("tab", { name: "Browser" });
    expect(tab).toBeDisabled();
    expect(tab).toHaveAccessibleDescription("Start or select a session to open its browser");
  });

  it("opens the first port of the session and links each port", async () => {
    const { pane } = await openBrowser([5173, 3000]);
    expect(within(pane).getByRole("textbox", { name: "Address" })).toHaveValue("http://crew.example.ts.net:3000/");
    const frame = within(pane).getByTitle("Page");
    expect(frame).toHaveAttribute("src", "http://crew.example.ts.net:3000/");
    expect(frame.getAttribute("sandbox")?.split(" ").sort()).toEqual(["allow-forms", "allow-modals", "allow-popups", "allow-same-origin", "allow-scripts"]);
    const ports = within(pane).getByRole("list", { name: "Ports" });
    expect(within(ports).getAllByRole("button").map((b) => b.textContent)).toEqual(["api :3000", "api :5173"]);
    expect(within(pane).getByRole("link", { name: "Open in browser" })).toHaveAttribute("href", "http://crew.example.ts.net:3000/");
  });

  it("goes to an address with the address rules", async () => {
    const { pane } = await openBrowser([3000]);
    const address = within(pane).getByRole("textbox", { name: "Address" });
    await userEvent.clear(address);
    await userEvent.type(address, "localhost:8080/admin{Enter}");
    expect(within(pane).getByTitle("Page")).toHaveAttribute("src", "http://crew.example.ts.net:8080/admin");
    expect(within(pane).queryByRole("alert")).toBeNull();
  });

  it("refuses an address that the rules do not accept", async () => {
    const { pane } = await openBrowser([3000]);
    const address = within(pane).getByRole("textbox", { name: "Address" });
    await userEvent.clear(address);
    await userEvent.type(address, "javascript:alert(1){Enter}");
    expect(within(pane).getByRole("alert")).toHaveTextContent("Type a port, a host or an http or https URL");
    expect(within(pane).getByTitle("Page")).toHaveAttribute("src", "http://crew.example.ts.net:3000/");
  });

  it("opens a port in a new tab and closes tabs", async () => {
    const { pane } = await openBrowser([3000, 5173]);
    await userEvent.click(within(pane).getByRole("button", { name: "api :5173" }));
    const tabs = within(pane).getByRole("tablist", { name: "Browser tabs" });
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["crew.example.ts.net:3000", "crew.example.ts.net:5173"]);
    expect(within(tabs).getByRole("tab", { name: "crew.example.ts.net:5173" })).toHaveAttribute("aria-selected", "true");
    expect(within(pane).getByTitle("Page")).toHaveAttribute("src", "http://crew.example.ts.net:5173/");
    await userEvent.click(within(pane).getByRole("button", { name: "Close crew.example.ts.net:5173" }));
    expect(within(tabs).getAllByRole("tab").map((t) => t.textContent)).toEqual(["crew.example.ts.net:3000"]);
    expect(within(pane).getByTitle("Page")).toHaveAttribute("src", "http://crew.example.ts.net:3000/");
  });

  it("shows an empty tab when the session has no ports", async () => {
    const { pane } = await openBrowser([]);
    expect(within(pane).getByRole("textbox", { name: "Address" })).toHaveValue("");
    expect(within(pane).queryByTitle("Page")).toBeNull();
    expect(within(pane).getByText("No process in the worktrees of this session listens on a TCP port.")).toBeInTheDocument();
  });

  it("tells which features of the Mac browser are not available", async () => {
    const { pane } = await openBrowser([3000]);
    expect(within(pane).getByRole("note")).toHaveTextContent("Profiles and agent control of this tab are not available. An agent uses the headless browser of the server.");
    expect(within(pane).queryByRole("button", { name: "Open in app browser" })).toBeNull();
  });

  it("opens the page of the tab in the app browser of the session in the desktop app", async () => {
    const app = fakeApp();
    const { pane } = await openBrowser([3000], notLive, { desktop: app.bridge });
    await userEvent.click(within(pane).getByRole("button", { name: "Open in app browser" }));
    await waitFor(() => expect(app.calls).toContainEqual({ cmd: "crew_browser_open", args: { session: "s1", url: "http://crew.example.ts.net:3000/" } }));
    expect(within(pane).getByRole("note")).toHaveTextContent("An agent controls the app browser of this session. You see each step there and can use the page at the same time.");
  });

  it("opens an empty app browser when the tab has no page", async () => {
    const app = fakeApp();
    const { pane } = await openBrowser([], notLive, { desktop: app.bridge });
    await userEvent.click(within(pane).getByRole("button", { name: "Open in app browser" }));
    await waitFor(() => expect(app.calls).toContainEqual({ cmd: "crew_browser_open", args: { session: "s1", url: null } }));
  });

  it("shows why the app browser did not open", async () => {
    const app = fakeApp((cmd) => (cmd === "crew_browser_open" ? Promise.reject("only the page of this computer can open the app browser") : Promise.resolve(null)));
    const { pane } = await openBrowser([3000], notLive, { desktop: app.bridge });
    await userEvent.click(within(pane).getByRole("button", { name: "Open in app browser" }));
    expect(await within(pane).findByRole("alert")).toHaveTextContent("only the page of this computer can open the app browser");
  });

  it("shows the headless browser of the server read-only while it is live", async () => {
    const { pane } = await openBrowser([3000], (server) => {
      server.on("GET", "/api/v1/sessions/s1/browser", { status: 200, body: { live: true, png: "iVBORw0KGgo=", width: 1280, height: 800 } });
    });
    const tabs = within(pane).getByRole("tablist", { name: "Browser tabs" });
    await userEvent.click(await within(tabs).findByRole("tab", { name: "Server browser" }));
    const frame = within(pane).getByRole("img", { name: "The headless browser of the server" });
    expect(frame).toHaveAttribute("src", "data:image/png;base64,iVBORw0KGgo=");
    expect(within(pane).queryByTitle("Page")).toBeNull();
    expect(within(pane).queryByRole("textbox", { name: "Address" })).toBeNull();
    expect(within(pane).getByText("Read-only. An agent controls this browser.")).toBeInTheDocument();
  });

  it("shows no server browser tab when the session has no headless tab", async () => {
    const { pane, server } = await openBrowser([3000]);
    await waitFor(() => expect(server.calls.some((c) => c.path === "/api/v1/sessions/s1/browser")).toBe(true));
    expect(within(pane).queryByRole("tab", { name: "Server browser" })).toBeNull();
  });

  it("sends a cookie file to the server browser", async () => {
    const { pane, server } = await openBrowser([3000], (server) => {
      notLive(server);
      server.on("POST", "/api/v1/browser/cookies", { status: 200, body: { imported: 2, total: 5 } });
    });
    const text = "example.com\tFALSE\t/\tFALSE\t0\tsid\tabc\n";
    await userEvent.upload(within(pane).getByLabelText("Send cookies to the server"), new File([text], "cookies.txt", { type: "text/plain" }));
    expect(await within(pane).findByRole("status")).toHaveTextContent("Sent 2 cookies to the server browser. It has 5 cookies.");
    expect(server.calls.find((c) => c.path === "/api/v1/browser/cookies")?.body).toEqual({ file: text });
  });

  it("shows why the server refused the cookie file", async () => {
    const { pane } = await openBrowser([3000], (server) => {
      notLive(server);
      server.on("POST", "/api/v1/browser/cookies", { status: 403, body: { error: { code: "forbidden", message: "only the owner device can do this" } } });
    });
    await userEvent.upload(within(pane).getByLabelText("Send cookies to the server"), new File(["[]"], "cookies.json", { type: "application/json" }));
    expect(await within(pane).findByRole("alert")).toHaveTextContent("only the owner device can do this");
  });
});
