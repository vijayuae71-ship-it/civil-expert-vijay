"use strict";
// Build step: add a fingerprint of each file's contents to the pages' links to assets/*.css and
// assets/*.js (assets/site.css → assets/site.css?v=3f9a1c2e). Browsers keep /assets/* for a day, so
// without it a phone can open a new page with yesterday's stylesheet or script. Runs after the CSS
// build on Netlify; safe to run again (an existing ?v= is replaced).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const hashes = {};
const hashOf = (rel) => {
  if (!(rel in hashes)) {
    const file = path.join(root, rel);
    hashes[rel] = fs.existsSync(file) ? crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 10) : null;
  }
  return hashes[rel];
};

function stamp(html) {
  return html.replace(/\b(src|href)="(\/?)(assets\/[\w.-]+\.(?:css|js))(?:\?v=[\w]+)?"/g, (all, attr, slash, rel) => {
    const h = hashOf(rel);
    return h ? `${attr}="${slash}${rel}?v=${h}"` : all;
  });
}

if (require.main === module) {
  let n = 0;
  const pages = fs.readdirSync(root).filter((f) => f.endsWith(".html"));
  if (fs.existsSync(path.join(root, "for"))) pages.push(...fs.readdirSync(path.join(root, "for")).filter((f) => f.endsWith(".html")).map((f) => `for/${f}`));
  for (const page of pages) {
    const file = path.join(root, page), before = fs.readFileSync(file, "utf8"), after = stamp(before);
    if (after !== before) { fs.writeFileSync(file, after); n++; }
  }
  console.log(`stamped asset links in ${n} pages`);
}

module.exports = { stamp };
