export function serverUrl(input) {
  const text = String(input ?? "").trim();
  if (text === "") {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : "https://" + text;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") {
    return null;
  }
  return url.origin + "/";
}

export function savedServers(storage) {
  let list = null;
  try {
    list = JSON.parse(storage.getItem("crew.servers") ?? "null");
  } catch {
    list = null;
  }
  if (Array.isArray(list)) {
    return list.filter((s) => typeof s === "string");
  }
  const old = storage.getItem("crew.server");
  return old ? [old] : [];
}

export function rememberServer(list, url) {
  return [url, ...list.filter((s) => s !== url)];
}

export function forgetServer(list, url) {
  return list.filter((s) => s !== url);
}
