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

test("the second site address forwards to the main site (civilengineervijay), and only that host is forwarded", () => {
  const toml = fs.readFileSync(path.join(root, "netlify.toml"), "utf8");
  const rules = [...toml.matchAll(/\[\[redirects\]\]([\s\S]*?)(?=\n\[|$)/g)].map((m) => m[1]);
  const fwd = rules.find((r) => /from = "https:\/\/constructionaiexpert/.test(r));
  assert.ok(fwd, "forward rule exists");
  assert.match(fwd, /from = "https:\/\/constructionaiexpert\.netlify\.app\/\*"/);
  assert.match(fwd, /to = "https:\/\/civilengineervijay\.netlify\.app\/:splat"/);
  assert.match(fwd, /status = 301/);
  assert.match(fwd, /force = true/);
  assert.ok(rules.every((r) => !/from = "\/\*"/.test(r)), "no catch-all rule that would also hit the main site");
});

test("pages, sitemap and share links name the main address only", () => {
  for (const f of fs.readdirSync(root).filter((x) => /\.(html|xml|txt)$/.test(x)).concat(["assets/site-config.js", "netlify/functions/whatsapp.js"])) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /constructionaiexpert\.netlify\.app/, f);
  }
});
