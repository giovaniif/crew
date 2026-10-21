export type Route = { screen: "list" } | { screen: "new" } | { screen: "session"; id: string; tab?: "shell" };

export function parseRoute(hash: string): Route {
  if (hash === "#/new") {
    return { screen: "new" };
  }
  const m = hash.match(/^#\/sessions\/([^/?#]+)(\/shell)?$/);
  if (!m) {
    return { screen: "list" };
  }
  try {
    const id = decodeURIComponent(m[1]);
    return m[2] ? { screen: "session", id, tab: "shell" } : { screen: "session", id };
  } catch {
    return { screen: "list" };
  }
}
