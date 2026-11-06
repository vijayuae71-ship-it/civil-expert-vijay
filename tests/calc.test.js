"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../assets/calc.js");
const val = (r, label) => r.results.find(([l]) => l.startsWith(label))[1];

test("concrete: 10 × 5 × 0.15 m slab", () => {
  const r = C.concrete({ length: 10, width: 5, depth: 0.15, wastagePct: 5 });
  assert.equal(val(r, "Net volume"), "7.5 m³");
  assert.equal(val(r, "Rounded"), "8 m³");
});

test("plaster: 100 sq ft, 12 mm, 1:4 ≈ 0.86 bag cement", () => {
  const r = C.plaster({ areaValue: 100, unit: "sqft", thicknessMm: 12, sandParts: 4, wastagePct: 5 });
  assert.match(val(r, "Cement"), /^0\.86 bags \(43 kg\)/);
  assert.match(val(r, "Sand"), /^0\.119 m³/);
});

test("paint: 12 × 10 ft room, 10 ft high, 2 coats, 10 m²/L ≈ 8.6 L walls only", () => {
  const r = C.paint({ length: 12, width: 10, height: 10, unit: "ft", coats: 2, coverage: 10, wastagePct: 5 });
  assert.equal(val(r, "Paint"), "8.6 litres");
  const withCeiling = C.paint({ length: 12, width: 10, height: 10, unit: "ft", includeCeiling: true, coats: 2, coverage: 10, wastagePct: 5 });
  assert.equal(val(withCeiling, "Paint"), "10.9 litres");
});

test("tiles: 20 m² with 600 × 600 tiles and 8% wastage", () => {
  const r = C.tiles({ areaValue: 20, tileLengthMm: 600, tileWidthMm: 600, wastagePct: 8, piecesPerBox: 4 });
  assert.equal(val(r, "Tiles"), "60 pieces");  // 20 / 0.36 = 55.6 × 1.08 = 60
  assert.equal(val(r, "Boxes"), "15");
  assert.match(val(r, "Tile adhesive"), /^84 kg ≈ 4 bags/);
});

test("steel: d²/162 weights and stirrup cutting length", () => {
  assert.match(val(C.steel({ diaMm: 12, barLengthM: 12, bars: 10 }), "Weight per metre"), /^0\.889/);
  assert.match(val(C.steel({ diaMm: 16, barLengthM: 12, bars: 10 }), "Total"), /^189\.6 kg/);
  const s = C.steel({ diaMm: 12, barLengthM: 12, bars: 1, memberWidthMm: 230, memberDepthMm: 450, coverMm: 25, stirrupDiaMm: 8 });
  assert.equal(val(s, "Stirrup cutting length"), "1,192 mm");  // 2(172+392)+160−48−48
});

test("brickwork: 1 m³ of modular bricks ≈ 500 bricks, ~1.2 bags cement in 1:6", () => {
  const r = C.brickwork({ length: 1, height: 1, thicknessMm: 1000, brick: "190x90x90", jointMm: 10, sandParts: 6, wastagePct: 0 });
  assert.equal(val(r, "Bricks"), "500 (incl. 0% wastage)");
  assert.match(val(r, "Cement"), /^1\.2\d? bags/);
});

test("AC: Dubai bedroom 4 × 5 m → 1.5 TR", () => {
  const r = C.acTonnage({ areaValue: 20, wattsPerM2: 170, people: 2, applianceW: 300 });
  assert.match(val(r, "Suggested AC size"), /^1\.5 TR/);
});

test("water tank: 100 persons × 135 L × 1 day", () => {
  const r = C.waterTank({ persons: 100, lpcd: 135, storageDays: 1 });
  assert.match(val(r, "Total storage"), /^13,500 litres/);
  assert.equal(val(r, "Underground"), "9,000 L");
});

test("bad input gives a clear message, not NaN", () => {
  assert.throws(() => C.plaster({ areaValue: 0 }), /Enter the area/);
  assert.throws(() => C.concrete({ length: 1, width: -2, depth: 1 }), /greater than zero/);
});

test("calculators page reads fields by name, not form.elements[key] (\"length\" is reserved there)", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "calculators.html"), "utf8");
  assert.doesNotMatch(html, /form\.elements\[/);
  for (const key of ["concrete", "plaster", "paint", "tiles", "steel", "brickwork", "acTonnage", "waterTank", "blockwork"]) assert.match(html, new RegExp(`Calc\\.${key}`));
});

test("service worker pre-caches only files that exist", () => {
  const fs = require("fs"), path = require("path");
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const list = JSON.parse(sw.match(/const CORE = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  for (const file of list) if (file !== "/") assert.ok(fs.existsSync(path.join(__dirname, "..", file)), file);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.webmanifest"), "utf8"));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(__dirname, "..", icon.src)), icon.src);
});
