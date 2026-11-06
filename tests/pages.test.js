"use strict";
// Catches JavaScript syntax errors in the pages' inline scripts (e.g. a stray apostrophe
// inside a quoted string), which would silently break the whole page.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
for (const page of fs.readdirSync(root).filter((f) => f.endsWith(".html"))) {
  test(`${page}: inline scripts parse`, () => {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    scripts.forEach((code, i) => assert.doesNotThrow(() => new Function(code), `script ${i}`));
  });
}

test("the microphone is allowed on the site (voice typing) — Permissions-Policy must not block it", () => {
  const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  const policy = (toml.match(/Permissions-Policy = "([^"]*)"/) || [])[1] || "";
  assert.doesNotMatch(policy, /microphone=\(\)/);
  assert.match(policy, /microphone=\(self\)/);
});
