export type SessionView = "shell" | "editor" | "agent" | "browser";

export type Route = { screen: "home" } | { screen: "list" } | { screen: "new" } | { screen: "session"; id: string; view?: SessionView };

export function parseRoute(hash: string): Route {
  if (hash === "" || hash === "#" || hash === "#/" || hash === "#/mates") {
    return { screen: "home" };
  }
  if (hash === "#/new") {
    return { screen: "new" };
  }
  const m = hash.match(/^#\/sessions\/([^/?#]+)(?:\/(shell|editor|agent|browser|terminal|nvim))?$/);
  if (!m) {
    return { screen: "list" };
  }
  try {
    const id = decodeURIComponent(m[1]);
    const alias: Record<string, SessionView> = { terminal: "agent", nvim: "editor" };
    return m[2] ? { screen: "session", id, view: alias[m[2]] ?? (m[2] as SessionView) } : { screen: "session", id };
  } catch {
    return { screen: "list" };
  }
}

export function openSessionView(id: string, view: SessionView): void {
  const base = "#/sessions/" + encodeURIComponent(id);
  const target = base + "/" + view;
  if (window.location.hash === target) {
    window.location.hash = base;
    setTimeout(() => {
      window.location.hash = target;
    }, 0);
    return;
  }
  window.location.hash = target;
}

export type NavItem = "mates" | "sessions" | "new" | "approvals" | "automations" | "envs" | "disk" | "settings" | "more";

const navPrefixes: [string, NavItem][] = [
  ["#/mates", "mates"],
  ["#/sessions", "sessions"],
  ["#/new", "new"],
  ["#/approvals", "approvals"],
  ["#/automations", "automations"],
  ["#/envs", "envs"],
  ["#/disk", "disk"],
  ["#/settings", "settings"],
  ["#/servers", "settings"],
  ["#/more", "more"],
];

export function navItem(hash: string): NavItem {
  if (parseRoute(hash).screen === "home") {
    return "mates";
  }
  const path = hash.split("?")[0];
  const hit = navPrefixes.find(([prefix]) => path === prefix || path.startsWith(prefix + "/"));
  return hit ? hit[1] : "sessions";
}

export type PhoneTab = "mates" | "sessions" | "approvals" | "more";

export function phoneTab(hash: string): PhoneTab {
  const item = navItem(hash);
  return item === "mates" || item === "sessions" || item === "approvals" ? item : item === "new" ? "sessions" : "more";
}
