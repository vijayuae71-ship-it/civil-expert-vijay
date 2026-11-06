/* Construction calculators: pure formulas, no page code, shared by calculators.html and the tests.
 * Every function returns { results: [[label, value], ...], steps: [text, ...], ask: "question for the AI" }.
 * These are preliminary planning figures, not designs; the page says so. */
(function (root) {
  "use strict";
  const SQFT_TO_M2 = 0.09290304, FT_TO_M = 0.3048, M3_TO_CFT = 35.3147;
  const CEMENT_DENSITY = 1440;   // kg/m³ loose bulk density
  const BAG_KG = 50;
  const DRY_FACTOR = 1.27;       // wet → dry volume of cement mortar (voids and bulking)

  const round = (n, d = 2) => Number.isFinite(n) ? Number(n.toFixed(d)) : NaN;
  const fmt = (n, d = 2) => round(n, d).toLocaleString("en-IN", { maximumFractionDigits: d });
  const area = (value, unit) => unit === "sqft" ? value * SQFT_TO_M2 : value;
  const len = (value, unit) => unit === "ft" ? value * FT_TO_M : value;
  const up = (n) => Math.ceil(Number(n.toFixed(6)));   // round up, ignoring floating-point dust (60.0000001 → 60)
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const positive = (...n) => n.every((x) => Number.isFinite(x) && x > 0);

  function concrete({ length, width, depth, wastagePct = 5 }) {
    need(positive(length, width, depth), "Enter length, width and depth greater than zero.");
    const net = length * width * depth, total = net * (1 + wastagePct / 100);
    return {
      results: [["Net volume", `${fmt(net, 3)} m³`], [`Order with ${fmt(wastagePct, 1)}% wastage`, `${fmt(total, 2)} m³`], ["Rounded RMC order", `${fmt(Math.ceil(total * 2) / 2, 1)} m³`]],
      steps: [`${fmt(length, 2)} × ${fmt(width, 2)} × ${fmt(depth, 3)} m = ${fmt(net, 3)} m³`, `× ${fmt(1 + wastagePct / 100, 3)} = ${fmt(total, 3)} m³, rounded up to the next 0.5 m³`],
      ask: `Concrete order for an element ${length} m × ${width} m × ${depth} m: what grade, slump and pour checks?`
    };
  }

  function blockwork({ length, height, blocksPerM2 = 12.5, wastagePct = 5 }) {
    need(positive(length, height, blocksPerM2), "Enter wall length and height greater than zero.");
    const a = length * height, net = up(a * blocksPerM2), total = up(net * (1 + wastagePct / 100));
    return {
      results: [["Wall area", `${fmt(a, 2)} m²`], ["Blocks (net)", `${net}`], [`Blocks with ${fmt(wastagePct, 1)}% wastage`, `${total}`]],
      steps: [`${fmt(length, 2)} × ${fmt(height, 2)} = ${fmt(a, 2)} m² (openings not deducted)`, `${fmt(a, 2)} × ${blocksPerM2} blocks/m² = ${net} blocks`],
      ask: `Blockwork for a ${length} m × ${height} m wall: mortar, ties and lintel checks?`
    };
  }

  // Cement–sand plaster. Mix 1:n by volume.
  function plaster({ areaValue, unit = "m2", thicknessMm = 12, sandParts = 4, wastagePct = 5 }) {
    need(positive(areaValue, thicknessMm, sandParts), "Enter the area, thickness and mix.");
    const A = area(areaValue, unit), wet = A * thicknessMm / 1000, dry = wet * DRY_FACTOR;
    const w = 1 + wastagePct / 100, cementM3 = dry / (1 + sandParts), cementKg = cementM3 * CEMENT_DENSITY * w;
    const sandM3 = cementM3 * sandParts * w;
    return {
      results: [["Cement", `${fmt(cementKg / BAG_KG, 2)} bags (${fmt(cementKg, 0)} kg)`], ["Sand", `${fmt(sandM3, 3)} m³ (${fmt(sandM3 * M3_TO_CFT, 1)} cft)`], ["Plaster area", `${fmt(A, 2)} m²`]],
      steps: [`Wet volume = ${fmt(A, 2)} m² × ${thicknessMm} mm = ${fmt(wet, 4)} m³`, `Dry volume = × ${DRY_FACTOR} = ${fmt(dry, 4)} m³`, `Cement = ${fmt(dry, 4)} ÷ (1 + ${sandParts}) = ${fmt(cementM3, 4)} m³ × ${CEMENT_DENSITY} kg/m³ × ${fmt(w, 2)} (wastage)`, `Sand = cement volume × ${sandParts} × ${fmt(w, 2)}`],
      ask: `How much cement and sand for ${areaValue} ${unit === "sqft" ? "sq ft" : "m²"} of ${thicknessMm} mm plaster in 1:${sandParts}, and how to apply it?`
    };
  }

  function paint({ length, width, height, unit = "ft", includeCeiling = false, openings = 0, coats = 2, coverage = 10, wastagePct = 5 }) {
    need(positive(length, width, height, coats, coverage), "Enter room size, coats and coverage.");
    const L = len(length, unit), W = len(width, unit), H = len(height, unit);
    const openingsM2 = area(openings || 0, unit === "ft" ? "sqft" : "m2");
    const walls = Math.max(0, 2 * (L + W) * H - openingsM2), ceiling = includeCeiling ? L * W : 0, A = walls + ceiling;
    const litres = A * coats / coverage * (1 + wastagePct / 100);
    return {
      results: [["Paint", `${fmt(litres, 1)} litres`], ["Area to paint", `${fmt(A, 1)} m² (${fmt(A / SQFT_TO_M2, 0)} sq ft)`], ["Coats", `${coats}`]],
      steps: [`Walls = 2 × (${fmt(L, 2)} + ${fmt(W, 2)}) × ${fmt(H, 2)} m − openings ${fmt(openingsM2, 2)} m² = ${fmt(walls, 2)} m²`, ...(includeCeiling ? [`Ceiling = ${fmt(L, 2)} × ${fmt(W, 2)} = ${fmt(ceiling, 2)} m²`] : []), `Paint = ${fmt(A, 2)} m² × ${coats} coats ÷ ${coverage} m²/L × ${fmt(1 + wastagePct / 100, 2)} = ${fmt(litres, 2)} L`, "Primer and putty are extra; use the coverage on the paint tin."],
      ask: `Paint for a ${length} × ${width} ${unit} room, ${height} ${unit} high, ${coats} coats: which primer, putty and paint system?`
    };
  }

  function tiles({ areaValue, unit = "m2", tileLengthMm = 600, tileWidthMm = 600, wastagePct = 8, piecesPerBox = 0, adhesiveKgPerM2 = 4, adhesiveBagKg = 25 }) {
    need(positive(areaValue, tileLengthMm, tileWidthMm), "Enter the area and tile size.");
    const A = area(areaValue, unit), tileM2 = tileLengthMm * tileWidthMm / 1e6;
    const count = up(A / tileM2 * (1 + wastagePct / 100));
    const adhesiveKg = A * adhesiveKgPerM2 * 1.05;
    return {
      results: [["Tiles", `${count} pieces`], ...(piecesPerBox > 0 ? [["Boxes", `${up(count / piecesPerBox)}`]] : []), ["Tile adhesive", `${fmt(adhesiveKg, 0)} kg ≈ ${up(adhesiveKg / adhesiveBagKg)} bags of ${adhesiveBagKg} kg`], ["Area", `${fmt(A, 2)} m²`]],
      steps: [`One tile = ${tileLengthMm} × ${tileWidthMm} mm = ${fmt(tileM2, 4)} m²`, `${fmt(A, 2)} ÷ ${fmt(tileM2, 4)} × ${fmt(1 + wastagePct / 100, 2)} (cutting/breakage) = ${count} tiles`, `Adhesive ≈ ${adhesiveKgPerM2} kg/m² (about 6 mm notch; larger tiles need more) × ${fmt(A, 2)} m² + 5%`],
      ask: `Tiling ${areaValue} ${unit === "sqft" ? "sq ft" : "m²"} with ${tileLengthMm}×${tileWidthMm} mm tiles: adhesive type, trowel notch and joint width?`
    };
  }

  // Steel: weight from d²/162 kg/m; optional stirrup cutting length (IS 2502-style bend deductions).
  function steel({ diaMm = 12, barLengthM = 12, bars = 1, memberWidthMm = 0, memberDepthMm = 0, coverMm = 25, stirrupDiaMm = 8 }) {
    need(positive(diaMm, barLengthM, bars), "Enter bar diameter, length and number of bars.");
    const kgPerM = diaMm * diaMm / 162, total = kgPerM * barLengthM * bars;
    const out = {
      results: [["Weight per metre", `${fmt(kgPerM, 3)} kg/m`], [`Total for ${bars} × ${fmt(barLengthM, 2)} m`, `${fmt(total, 1)} kg (${fmt(total / 1000, 3)} t)`]],
      steps: [`Weight = d² ÷ 162 = ${diaMm}² ÷ 162 = ${fmt(kgPerM, 3)} kg/m`, `${fmt(kgPerM, 3)} × ${fmt(barLengthM, 2)} m × ${bars} = ${fmt(total, 2)} kg`],
      ask: `Steel for ${bars} bars of ${diaMm} mm × ${barLengthM} m: lap length, cover and bar bending checks?`
    };
    if (positive(memberWidthMm, memberDepthMm, stirrupDiaMm) && memberWidthMm > 2 * coverMm && memberDepthMm > 2 * coverMm) {
      const d = stirrupDiaMm, a = memberWidthMm - 2 * coverMm - d, b = memberDepthMm - 2 * coverMm - d;
      const cl = 2 * (a + b) + 2 * 10 * d - 3 * 2 * d - 2 * 3 * d;
      out.results.push([`Stirrup cutting length (${d} mm)`, `${fmt(cl, 0)} mm`]);
      out.steps.push(`Stirrup centreline: a = ${memberWidthMm} − 2×${coverMm} − ${d} = ${a} mm, b = ${memberDepthMm} − 2×${coverMm} − ${d} = ${b} mm`, `Cutting length = 2(a + b) + 2 hooks × 10d − 3 bends × 2d − 2 hooks × 3d = ${fmt(cl, 0)} mm (follow the drawing / BBS if different)`);
      out.ask = `Check stirrup cutting length for a ${memberWidthMm} × ${memberDepthMm} mm beam, ${coverMm} mm cover, ${d} mm stirrups.`;
    }
    return out;
  }

  // Brickwork in cement mortar 1:n. Brick sizes in mm (without joint).
  function brickwork({ length, height, thicknessMm = 230, brick = "190x90x90", jointMm = 10, sandParts = 6, wastagePct = 5 }) {
    need(positive(length, height, thicknessMm), "Enter wall length, height and thickness.");
    const [bl, bw, bh] = brick.split("x").map(Number);
    const vol = length * height * thicknessMm / 1000;
    const unitVol = (bl + jointMm) * (bw + jointMm) * (bh + jointMm) / 1e9, brickVol = bl * bw * bh / 1e9;
    const netBricks = vol / unitVol, bricks = up(netBricks * (1 + wastagePct / 100));
    const mortarWet = Math.max(0, vol - netBricks * brickVol), mortarDry = mortarWet * DRY_FACTOR;
    const cementM3 = mortarDry / (1 + sandParts), cementKg = cementM3 * CEMENT_DENSITY, sandM3 = cementM3 * sandParts;
    return {
      results: [["Bricks", `${bricks} (incl. ${fmt(wastagePct, 1)}% wastage)`], ["Cement", `${fmt(cementKg / BAG_KG, 2)} bags (${fmt(cementKg, 0)} kg)`], ["Sand", `${fmt(sandM3, 3)} m³ (${fmt(sandM3 * M3_TO_CFT, 1)} cft)`], ["Wall volume", `${fmt(vol, 3)} m³`]],
      steps: [`Wall = ${fmt(length, 2)} × ${fmt(height, 2)} × ${thicknessMm / 1000} m = ${fmt(vol, 3)} m³`, `Brick with ${jointMm} mm joint = ${(bl + jointMm)} × ${(bw + jointMm)} × ${(bh + jointMm)} mm → ${fmt(1 / unitVol, 0)} bricks/m³`, `Mortar (wet) = wall − bricks = ${fmt(mortarWet, 3)} m³; dry × ${DRY_FACTOR} = ${fmt(mortarDry, 3)} m³`, `Cement = dry ÷ (1 + ${sandParts}) × ${CEMENT_DENSITY} kg/m³; sand = cement volume × ${sandParts}`],
      ask: `Brickwork ${length} m × ${height} m × ${thicknessMm} mm in 1:${sandParts}: curing, bond and quality checks?`
    };
  }

  // Air-conditioning rule of thumb (hot climate). Not a heat-load calculation.
  const AC_SIZES = [0.75, 1, 1.5, 2, 2.5, 3, 4, 5];
  function acTonnage({ areaValue, unit = "m2", wattsPerM2 = 170, people = 2, applianceW = 300 }) {
    need(positive(areaValue, wattsPerM2), "Enter the room area.");
    const A = area(areaValue, unit), kW = A * wattsPerM2 / 1000 + Math.max(0, people) * 0.1 + Math.max(0, applianceW) / 1000;
    const tr = kW / 3.517, size = AC_SIZES.find((s) => s >= tr) || Math.ceil(tr);
    return {
      results: [["Suggested AC size", `${size} TR (${fmt(size * 12000, 0)} BTU/h)`], ["Estimated cooling load", `${fmt(kW, 2)} kW ≈ ${fmt(tr, 2)} TR`], ["Room area", `${fmt(A, 1)} m² (${fmt(A / SQFT_TO_M2, 0)} sq ft)`]],
      steps: [`Room: ${fmt(A, 2)} m² × ${wattsPerM2} W/m² = ${fmt(A * wattsPerM2 / 1000, 2)} kW`, `People: ${people} × 0.1 kW; appliances/lights: ${fmt(applianceW / 1000, 2)} kW`, `${fmt(kW, 2)} kW ÷ 3.517 kW/TR = ${fmt(tr, 2)} TR → next standard size ${size} TR`],
      ask: `AC size for a ${areaValue} ${unit === "sqft" ? "sq ft" : "m²"} room (${wattsPerM2} W/m² assumption): check my heat load.`
    };
  }

  function waterTank({ persons, lpcd = 135, storageDays = 1, undergroundShare = 2 / 3 }) {
    need(positive(persons, lpcd, storageDays), "Enter persons, litres per person per day and days of storage.");
    const daily = persons * lpcd, total = daily * storageDays, ug = total * undergroundShare, oh = total - ug;
    return {
      results: [["Total storage", `${fmt(total, 0)} litres (${fmt(total / 1000, 1)} m³)`], ["Underground sump", `${fmt(ug, 0)} L`], ["Overhead tank", `${fmt(oh, 0)} L`], ["Daily demand", `${fmt(daily, 0)} L/day`]],
      steps: [`${persons} persons × ${lpcd} L/person/day = ${fmt(daily, 0)} L/day`, `× ${storageDays} day(s) = ${fmt(total, 0)} L`, `Split ${fmt(undergroundShare * 100, 0)}% underground / ${fmt((1 - undergroundShare) * 100, 0)}% overhead. Fire-fighting storage is separate.`],
      ask: `Water tank sizing for ${persons} persons at ${lpcd} L/person/day: pump, tank compartments and fire storage?`
    };
  }

  const api = { concrete, blockwork, plaster, paint, tiles, steel, brickwork, acTonnage, waterTank, round, SQFT_TO_M2 };
  if (typeof module === "object" && module.exports) module.exports = api; else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
