export type SessionView = "shell" | "editor" | "agent" | "browser";

export type Route = { screen: "list" } | { screen: "new" } | { screen: "session"; id: string; view?: SessionView };

export function parseRoute(hash: string): Route {
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
