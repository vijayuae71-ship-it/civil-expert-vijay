/* Material delivery requests ("📦 Get delivery quotes"), India, non-cement materials first.
 * Picks the materials and quantities out of an AI answer, a BOQ table or a calculator result, so the
 * person starts from a ready list they can edit. Cement, ready-mix concrete and GGBS are left out for
 * now; work items (excavation, brick masonry in m³, plastering) are not materials and are left out too.
 *   Leads.fromText(text)            → [{ name, qty, unit, category }]
 *   Leads.fromCalc(id, results, args) → the same, from a calculator's results
 *   Leads.categoryOf(name, unit)    → category key, or null (not a deliverable material / excluded)
 *   Leads.clean(lead)               → a checked request, or throws with a plain message
 */
(function (root) {
  "use strict";
  // Each category: what it is called, and the units its quantity can be in (so a work item measured in
  // m³ of brickwork is not taken for a number of bricks).
  const CATEGORIES = [
    ["steel", "Steel (TMT bars)", /\b(tmt|rebar|reinforcement|steel bars?|steel|fe\s?-?5\d\d\w?|binding wire)\b/i, /^(kg|kgs|t|ton|tons|tonne|tonnes|mt|quintals?|nos|bars?|bundles?)$/i],
    ["sand", "Sand (M-sand / P-sand / river)", /\b(m-?sand|p-?sand|river sand|plaster sand|sand)\b/i, /^(m3|m³|cum|cu\.?\s?m|cft|cu\.?\s?ft|t|ton|tons|tonne|tonnes|units?|loads?|brass)$/i],
    ["aggregate", "Aggregate / jelly", /\b(aggregate|jelly|jelli|blue metal|metal\s?\d|gravel|coarse)\b/i, /^(m3|m³|cum|cu\.?\s?m|cft|cu\.?\s?ft|t|ton|tons|tonne|tonnes|units?|loads?|brass)$/i],
    ["bricks", "Bricks", /\bbricks?\b/i, /^(nos|no|numbers?|pcs|pieces?|bricks?|thousands?|1000s?)$/i],
    ["blocks", "Blocks (solid / AAC)", /\b(aac|solid blocks?|hollow blocks?|concrete blocks?|cement blocks?|blocks?)\b/i, /^(nos|no|numbers?|pcs|pieces?|blocks?|m3|m³|cum)$/i],
    ["tiles", "Tiles and adhesive", /\b(tiles?|vitrified|ceramic|granite|marble|tile adhesive)\b/i, /^(nos|no|pcs|pieces?|boxes?|box|sq\.?\s?ft|sft|sqft|m2|m²|sqm|sq\.?\s?m|kg|kgs|bags?)$/i],
    ["paint", "Paint, primer and putty", /\b(paint|primer|putty|emulsion|enamel|distemper)\b/i, /^(l|lt|ltr|ltrs|litres?|liters?|kg|kgs|buckets?|tins?|bags?)$/i],
    ["waterproofing", "Waterproofing", /\bwater\s?-?proof/i, /^(kg|kgs|l|lt|ltr|litres?|liters?|buckets?|tins?|sq\.?\s?ft|sft|m2|m²|sqm|rolls?)$/i],
    ["plumbing", "Plumbing pipes and fittings", /\b(cpvc|upvc|ppr|pvc|swr|pipes?|fittings?|valves?|taps?)\b/i, /^(m|rm|rmt|metres?|meters?|ft|feet|lengths?|nos|no|pcs|pieces?)$/i],
    ["electrical", "Electrical wires and fittings", /\b(wires?|cables?|mcb|rccb|conduits?|switch(es)?|sockets?)\b/i, /^(m|rm|rmt|metres?|meters?|coils?|rolls?|nos|no|pcs|pieces?)$/i],
    ["wood", "Plywood and timber", /\b(plywood|shuttering ply|ply|timber|wood)\b/i, /^(sheets?|nos|no|pcs|sq\.?\s?ft|sft|sqft|cft|m2|m²|m3|m³)$/i]
  ];
  // Not offered yet (cement-based), and work items that are not a material to deliver.
  const EXCLUDED = /\b(cement|opc|ppc|psc|ggbs|ready[\s-]?mix|rmc|concrete(?!\s*blocks?)|pcc|rcc|mortar)\b/i;
  const WORK = /\b(excavation|masonry|plaster(ing)?\b(?!\s*sand)|laying|providing|fixing|labour|curing|shuttering work|formwork|centering)\b/i;
  const LABEL = Object.fromEntries(CATEGORIES.map(([k, l]) => [k, l]));
  const normUnit = (u) => String(u || "").trim().replace(/\.$/, "").replace(/^cu\.?\s?m$/i, "m³").replace(/^m3$/i, "m³").replace(/^sq\.?\s?ft|^sft$|^sqft$/i, "sq ft").replace(/^m2$|^sqm$/i, "m²");

  function categoryOf(name, unit) {
    const n = String(name || "");
    if (!n || EXCLUDED.test(n)) return null;
    const c = CATEGORIES.find(([, , re]) => re.test(n));
    if (!c) return null;
    if (WORK.test(n) && !/\b(sand|tiles?|paint|pipes?|wires?)\b/i.test(n.replace(WORK, ""))) return null;
    if (unit !== undefined && unit !== null && String(unit).trim() && !c[3].test(String(unit).trim().replace(/\.$/, ""))) return null;
    return c[0];
  }

  const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/,/g, "")); return Number.isFinite(n) ? n : NaN; };
  const round = (n) => (n >= 100 ? Math.round(n) : Math.round(n * 100) / 100);
  function add(list, name, qty, unit) {
    const q = num(qty), u = normUnit(unit), cat = categoryOf(name, u);
    if (!cat || !(q > 0)) return;
    const clean = String(name).replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (list.some((x) => x.name.toLowerCase() === clean.toLowerCase() && x.unit === u)) return;
    list.push({ name: clean, qty: round(q), unit: u, category: cat });
  }

  // Tables first (BOQs), then plain lines such as "about 0.13 m³ sand (about 4.5 cft)".
  const UNIT = "kg|kgs|t|tonnes?|tons?|mt|quintals?|bags?|nos|no|numbers?|pcs|pieces?|boxes?|litres?|liters?|ltrs?|l|m³|m3|cum|cft|sq\\.? ?ft|sqft|m²|m2|rm|rmt|metres?|meters?|m|coils?|sheets?|units?|loads?|brass|bricks?|blocks?|tins?|buckets?";
  function fromText(text) {
    const list = [];
    const Q = root.QUOTE || (typeof module === "object" && module.exports ? require("./quote.js") : null);
    if (Q && Q.itemsFromAnswer) for (const it of Q.itemsFromAnswer(text) || []) add(list, it.description, it.qty, it.unit);
    for (const raw of String(text || "").split(/\n/)) {
      if (/^\s*\|/.test(raw)) continue;   // table rows were read above
      const line = raw.replace(/\*\*/g, "").replace(/≈|~|about|approx\.?|approximately|around/gi, " ");
      const a = new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT})(?![A-Za-z])\\.?\\s*(?:of\\s+)?([A-Za-z][A-Za-z0-9 .\\-/]{1,40})`, "gi");
      let m;
      while ((m = a.exec(line))) { const name = m[3].split(/[(,;:]| and | for | to /i)[0].trim(); add(list, name, m[1], m[2]); }
      const b = new RegExp(`([A-Za-z][A-Za-z0-9 .\\-/]{1,40}?)\\s*[:\\-–]\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${UNIT})(?![A-Za-z])`, "gi");
      while ((m = b.exec(line))) add(list, m[1].trim(), m[2], m[3]);
    }
    return list;
  }

  // Calculator results ([[label, value], …]) → materials, by calculator.
  const firstNum = (v) => num((String(v).match(/\d[\d,]*(?:\.\d+)?/) || [""])[0]);
  function fromCalc(id, results, args = {}) {
    const r = Object.fromEntries((results || []).map(([l, v]) => [String(l), String(v)]));
    const find = (re) => { const k = Object.keys(r).find((x) => re.test(x)); return k ? r[k] : null; };
    const list = [];
    const put = (name, qty, unit) => { const q = firstNum(qty); if (q > 0) list.push({ name, qty: round(q), unit, category: categoryOf(name, unit) }); };
    if (id === "plaster" && find(/^Sand/)) put("Plaster sand (M-sand / river sand)", find(/^Sand/), "m³");
    if (id === "brickwork") { if (find(/^Bricks/)) put("Bricks", find(/^Bricks/), "nos"); if (find(/^Sand/)) put("Sand (M-sand / river sand)", find(/^Sand/), "m³"); }
    if (id === "blocks" && find(/^Blocks with/)) put("Concrete blocks", find(/^Blocks with/), "nos");
    if (id === "paint" && find(/^Paint/)) put("Paint (emulsion)", find(/^Paint/), "litres");
    if (id === "tiles") {
      if (find(/^Boxes/)) put(`Tiles ${args.tileLengthMm || ""}×${args.tileWidthMm || ""} mm`.replace(" ×", ""), find(/^Boxes/), "boxes");
      else if (find(/^Tiles/)) put(`Tiles ${args.tileLengthMm || ""}×${args.tileWidthMm || ""} mm`.replace(" ×", ""), find(/^Tiles/), "nos");
      if (find(/^Tile adhesive/)) put("Tile adhesive", find(/^Tile adhesive/), "kg");
    }
    if (id === "steel" && find(/^Total for/)) put(`TMT steel ${args.diaMm || ""} mm`.replace("  ", " "), find(/^Total for/), "kg");
    return list.filter((x) => x.category);
  }

  // A request as the person sends it: checked and trimmed (the server checks it again).
  function clean(input = {}) {
    const s = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
    const items = (Array.isArray(input.items) ? input.items : []).slice(0, 30).map((x) => ({ name: s(x.name, 80), qty: num(x.qty), unit: s(normUnit(x.unit), 20), category: categoryOf(x.name) || "other" }))
      .filter((x) => x.name && x.qty > 0 && x.qty < 1e7 && !EXCLUDED.test(x.name));
    if (!items.length) throw new Error("Add at least one material with its quantity.");
    const phone = String(input.phone || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new Error("Enter a 10-digit Indian mobile number.");
    const pin = String(input.pin || "").replace(/\D/g, "");
    if (!/^[1-9]\d{5}$/.test(pin)) throw new Error("Enter the 6-digit PIN code of the delivery site.");
    const city = s(input.city, 40);
    if (!city) throw new Error("Choose the city.");
    if (input.consent !== true) throw new Error("Please tick the box to let us share your request with suppliers.");
    const day = s(input.neededBy, 10);
    return {
      items, city, area: s(input.area, 80), pin, neededBy: /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "",
      name: s(input.name, 60), phone: `+91${phone}`, role: s(input.role, 40), notes: s(input.notes, 300),
      source: s(input.source, 40), trade: s(input.trade, 30), consent: true
    };
  }

  // The request as a WhatsApp message (owner → supplier).
  function message(lead) {
    const lines = [`*Material delivery request* — ${lead.city}${lead.area ? `, ${lead.area}` : ""} ${lead.pin}`];
    if (lead.neededBy) lines.push(`Needed by: ${lead.neededBy}`);
    lines.push("");
    lead.items.forEach((x, i) => lines.push(`${i + 1}. ${x.name} — ${x.qty} ${x.unit}`));
    lines.push("");
    if (lead.role) lines.push(`Customer: ${lead.role}`);
    if (lead.notes) lines.push(`Notes: ${lead.notes}`);
    lines.push("Please reply with your price including delivery.");
    return lines.join("\n");
  }

  const CITIES = ["Bengaluru", "Mysuru", "Mangaluru", "Hubballi-Dharwad", "Belagavi", "Chennai", "Coimbatore", "Hyderabad", "Kochi", "Thiruvananthapuram", "Mumbai", "Pune", "Delhi NCR", "Ahmedabad", "Kolkata"];
  const api = { CATEGORIES: CATEGORIES.map(([k, l]) => [k, l]), LABEL, CITIES, categoryOf, fromText, fromCalc, clean, message, normUnit, EXCLUDED };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Leads = api;
})(typeof self !== "undefined" ? self : this);
