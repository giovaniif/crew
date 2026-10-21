import assert from "node:assert/strict";
import { test } from "node:test";
import { serverUrl } from "./server.js";

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
