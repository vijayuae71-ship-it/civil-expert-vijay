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

test("the build stamps asset links with a content fingerprint, so a new page never gets an old stylesheet", () => {
  const { stamp } = require("../scripts/stamp-assets.js");
  const out = stamp('<link rel="stylesheet" href="assets/site.css"><script src="assets/consult.js?v=old"></script><script src="assets/missing.js"></script><a href="consultant.html">x</a>');
  assert.match(out, /href="assets\/site\.css\?v=[0-9a-f]{10}"/);
  assert.match(out, /src="assets\/consult\.js\?v=[0-9a-f]{10}"/);
  assert.doesNotMatch(out, /v=old/);
  assert.match(out, /src="assets\/missing\.js"/, "a missing file is left alone");
  assert.equal(stamp(out), out, "running it again changes nothing");
  assert.match(require("../package.json").scripts.build, /stamp-assets\.js/);
  assert.match(fs.readFileSync(path.join(root, "netlify.toml"), "utf8"), /command = "npm run build"/);
});

test("PDF text: lines jsPDF cannot write (Tamil, Hindi, Arabic, ≤) are drawn as pictures; plain lines stay text", () => {
  const P = require("../assets/pdftext.js");
  for (const t of ["Excavation 12 mm × 2 – “ok” • Rs. 1,200 €", "M25 – 0.5% ±"]) assert.equal(P.needsPicture(t), false, t);
  for (const t of ["முற்றத்தில்", "सीमेंट प्लास्टर", "ಕವರ್ ಬ್ಲಾಕ್", "خرسانة", "≤ 0.05D", "混凝土"]) assert.equal(P.needsPicture(t), true, t);
  // wrapping by words, and by characters inside a word that is too long (or text without spaces)
  const cx = { measureText: (s) => ({ width: Array.from(s).length * 10 }) };
  assert.deepEqual(P.wrap(cx, "aaa bbb ccc", 75), ["aaa bbb", "ccc"]);
  assert.deepEqual(P.wrap(cx, "混凝土强度等级", 30), ["混凝土", "强度等", "级"]);
  const html = fs.readFileSync(path.join(root, "expert.html"), "utf8");
  assert.match(html, /src="assets\/pdftext\.js"/);
  assert.match(fs.readFileSync(path.join(root, "sw.js"), "utf8"), /\/assets\/pdftext\.js/);
});
