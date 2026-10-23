import assert from "node:assert/strict";
import { test } from "node:test";
import { failureText, forgetServer, rememberServer, savedServers, serverUrl } from "./server.js";

test("a bare host gets https and a trailing slash", () => {
  assert.equal(serverUrl("crew.example.ts.net"), "https://crew.example.ts.net/");
});

test("a full URL keeps its scheme and port and drops the path", () => {
  assert.equal(serverUrl("  http://crew.example.ts.net:7420/sessions?x=1 "), "http://crew.example.ts.net:7420/");
});

test("empty input and other schemes are refused", () => {
  assert.equal(serverUrl("   "), null);
  assert.equal(serverUrl("ftp://crew.example.ts.net"), null);
  assert.equal(serverUrl("https://"), null);
});

function memory(entries) {
  const map = new Map(entries);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
}

test("saved servers start from the old single address", () => {
  const kv = memory([["crew.server", "https://old.example.ts.net/"]]);
  assert.deepEqual(savedServers(kv), ["https://old.example.ts.net/"]);
  kv.setItem("crew.servers", JSON.stringify(["https://a.example.ts.net/", 3, "https://b.example.ts.net/"]));
  assert.deepEqual(savedServers(kv), ["https://a.example.ts.net/", "https://b.example.ts.net/"]);
  assert.deepEqual(savedServers(memory([])), []);
});

test("a remembered server goes first and is not repeated", () => {
  assert.deepEqual(rememberServer(["https://a/", "https://b/"], "https://b/"), ["https://b/", "https://a/"]);
  assert.deepEqual(rememberServer([], "https://a/"), ["https://a/"]);
});

test("a forgotten server leaves the list", () => {
  assert.deepEqual(forgetServer(["https://a/", "https://b/"], "https://a/"), ["https://b/"]);
});

test("a fix error gives its text, or a reason when it has none", () => {
  const none = "Fix stopped and gave no reason. See serve.log in the app log folder.";
  assert.equal(failureText("crew serve did not start"), "crew serve did not start");
  assert.equal(failureText(new Error("boom")), "boom");
  assert.equal(failureText({ message: "denied" }), "denied");
  assert.equal(failureText("  "), none);
  assert.equal(failureText(undefined), none);
});
