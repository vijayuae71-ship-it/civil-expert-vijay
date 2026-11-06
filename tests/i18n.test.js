"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "assets", "i18n.js"), "utf8"), sandbox);
const I18N = sandbox.window.I18N;
const html = fs.readFileSync(path.join(__dirname, "..", "expert.html"), "utf8");

test("every language has every key, with no empty strings", () => {
  const keys = Object.keys(I18N.en);
  for (const [lang, dict] of Object.entries(I18N)) {
    for (const k of keys) assert.ok(typeof dict[k] === "string" && dict[k].trim(), `${lang}.${k}`);
    for (const k of Object.keys(dict)) assert.ok(k in I18N.en, `${lang} has unknown key ${k}`);
  }
});

test("placeholders like {lang} are kept in every translation", () => {
  for (const [lang, dict] of Object.entries(I18N)) assert.match(dict.listening, /\{lang\}/, lang);
});

test("every data-i18n key used on the page exists", () => {
  const used = [...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 30);
  for (const k of used) assert.ok(k in I18N.en, k);
  for (const m of html.matchAll(/\bt\('([a-zA-Z_]+)'/g)) assert.ok(m[1] in I18N.en, `t('${m[1]}')`);
});

test("the languages named on the welcome line all have page text", () => {
  for (const lang of ["hi", "ur", "ml", "ta", "bn", "ne", "te", "pa", "ar"]) assert.ok(I18N[lang], lang);
});
