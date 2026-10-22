export type RouteTab = "shell" | "terminal" | "nvim" | "browser";

export type Route = { screen: "list" } | { screen: "new" } | { screen: "session"; id: string; tab?: RouteTab };

export function parseRoute(hash: string): Route {
  if (hash === "#/new") {
    return { screen: "new" };
  }
  const m = hash.match(/^#\/sessions\/([^/?#]+)(?:\/(shell|terminal|nvim|browser))?$/);
  if (!m) {
    return { screen: "list" };
  }
  try {
    const id = decodeURIComponent(m[1]);
    return m[2] ? { screen: "session", id, tab: m[2] as RouteTab } : { screen: "session", id };
  } catch {
    return { screen: "list" };
  }
}

export function openSessionView(id: string, tab: RouteTab): void {
  const base = "#/sessions/" + encodeURIComponent(id);
  const target = base + "/" + tab;
  if (window.location.hash === target) {
    window.location.hash = base;
    setTimeout(() => {
      window.location.hash = target;
    }, 0);
    return;
  }
  window.location.hash = target;
}
