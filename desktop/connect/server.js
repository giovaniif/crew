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
