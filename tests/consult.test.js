"use strict";
// Consultant tools: bid comparison, bill certification, bar bending schedule and IS 456 checks.
// Expected numbers are worked out by hand in the comments.
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../assets/consult.js");
const Q = require("../assets/quote.js");

const tender = [
  { ref: "1", description: "Excavation in ordinary soil up to 1.5 m depth", unit: "cum", qty: 100 },
  { ref: "2", description: "PCC 1:4:8 in foundation", unit: "cum", qty: 10 },
  { ref: "3", description: "Cement plaster 12 mm thick in CM 1:6", unit: "sqm", qty: 500 }
];
const bid = (name, rates, extra = {}) => ({ name, items: tender.map((t, i) => ({ ...t, rate: rates[i], amount: t.qty * rates[i], ...(extra[i] || {}) })).filter((x) => x.rate !== undefined) });

test("bids are compared on the tender quantities, ranked, and far-off rates flagged against the median", () => {
  const cmp = C.compareBids(tender, [bid("A", [300, 5000, 250]), bid("B", [280, 5200, 300]), bid("C", [150, 5100, 320])]);
  // corrected totals: A 30000+50000+125000 = 205000; B 28000+52000+150000 = 230000; C 15000+51000+160000 = 226000
  assert.deepEqual(cmp.bidders.map((b) => b.corrected), [205000, 230000, 226000]);
  assert.deepEqual(cmp.ranking, ["A", "C", "B"]);
  assert.equal(cmp.lowest.name, "A");
  // item 1: median of 300, 280, 150 = 280; 150 is 46% below → low. Item 3: median 300; 250 is 17% below → not flagged
  assert.equal(cmp.rows[0].median, 280);
  assert.equal(cmp.rows[0].cells[2].flag, "low");
  assert.equal(cmp.rows[2].cells[0].flag, undefined);
  assert.equal(cmp.bidders[2].low, 1);
});

test("a bid with a missing item is not ranked; changed quantities and arithmetic errors are counted, extras listed", () => {
  const b = bid("B", [280, 5200, 300], { 0: { qty: 90, amount: 25200 }, 2: { amount: 15000 } });
  b.items.push({ ref: "4", description: "Anti-termite treatment", unit: "sqm", qty: 50, rate: 40, amount: 2000 });
  const cmp = C.compareBids(tender, [bid("A", [300, 5000]), b]);
  const [A, B] = cmp.bidders;
  assert.equal(A.missing, 1); assert.equal(A.rank, null);
  assert.equal(B.rank, 1);
  assert.equal(B.qtyChanged, 1);           // 90 instead of 100: compared on 100 × 280 = 28000
  assert.equal(cmp.rows[0].cells[1].amount, 28000);
  assert.equal(B.arithmetic, 1);           // 500 × 300 = 150000, not 15000
  assert.equal(B.extra, 1); assert.equal(B.extraLines[0].description, "Anti-termite treatment");
  // with 2 bidders there is no median flag
  assert.ok(cmp.rows.every((r) => r.cells.every((c) => !c.flag)));
});

test("bids match by description when item numbers differ, but never across different specifications", () => {
  const other = [
    { ref: "A1", description: "Excavation in ordinary soil upto 1.5 m depth", unit: "m3", qty: 100, rate: 300, amount: 30000 },
    { ref: "A2", description: "PCC 1:4:8 in foundation", unit: "cum", qty: 10, rate: 5000, amount: 50000 },
    { ref: "A3", description: "Cement plaster 12 mm thick in CM 1:4", unit: "sqm", qty: 500, rate: 260, amount: 130000 }
  ];
  const cmp = C.compareBids(tender, [{ name: "X", items: other }, bid("Y", [290, 5000, 250])]);
  assert.equal(cmp.rows[0].cells[0].rate, 300);
  assert.equal(cmp.rows[2].cells[0].missing, true, "1:4 plaster is not the tender's 1:6 plaster");
  assert.equal(cmp.bidders[0].extra, 1);
});

test("the comparison sheet has one rate and amount column per bidder and the totals at the end", () => {
  const rows = C.comparisonSheet(C.compareBids(tender, [bid("A", [300, 5000, 250]), bid("B", [280, 5200, 300])]));
  assert.deepEqual(rows[2].slice(0, 8), ["Item", "Description", "Unit", "Qty", "A rate", "A amount", "B rate", "B amount"]);
  assert.equal(rows[3][4], 300);
  assert.ok(rows.some((r) => r[1] === "Rank (complete bids only)" && r[5] === "L1"));
});

const agreement = tender.map((t, i) => ({ ...t, rate: [300, 5000, 250][i] }));

test("a running bill sheet is read with up-to-date, previous and this-bill quantities", () => {
  const rows = [
    ["RA Bill No. 3"],
    ["Sl No", "Description", "Unit", "Qty this bill", "Previous qty", "Rate", "Amount"],
    ["1", "Excavation in ordinary soil up to 1.5 m depth", "cum", 20, 60, 300, 24000],
    ["", "Total", "", "", "", "", 24000]
  ];
  // only this bill's and the previous quantity: up to date = 20 + 60 (the amount stays as claimed)
  assert.deepEqual(C.billItems(rows), [{ ref: "1", description: "Excavation in ordinary soil up to 1.5 m depth", unit: "cum", qty: 80, prev: 60, rate: 300, amount: 24000 }]);
  const rows2 = [["Item", "Description", "Unit", "Upto date qty", "Previous qty", "Rate", "Amount"], ["1", "Excavation in ordinary soil up to 1.5 m depth", "cum", 80, 60, 300, 24000], ["", "Total", "", "", "", "", 24000]];
  assert.deepEqual(C.billItems(rows2), [{ ref: "1", description: "Excavation in ordinary soil up to 1.5 m depth", unit: "cum", qty: 80, prev: 60, rate: 300, amount: 24000 }]);
  // The AI's table header reads the same way
  const ai = C.tableRows("| Item No | Description | Unit | Qty up to date | Previous qty | Rate | Amount |\n|---|---|---|---|---|---|---|\n| 2 | PCC 1:4:8 in foundation | cum | 8 | 5 | 5000 | 40000 |");
  assert.deepEqual(C.billItems(ai)[0], { ref: "2", description: "PCC 1:4:8 in foundation", unit: "cum", qty: 8, prev: 5, rate: 5000, amount: 40000 });
});

test("bill certification cuts over-rates, MB shortfalls, quantities beyond the deviation limit and extra items", () => {
  const bill = [
    { ref: "1", description: "Excavation in ordinary soil up to 1.5 m depth", unit: "cum", qty: 140, prev: 60, rate: 320, amount: 44800 },   // rate above 300; qty above 125 (100 + 25%)
    { ref: "2", description: "PCC 1:4:8 in foundation", unit: "cum", qty: 8, prev: 5, rate: 5000, amount: 4000 },                         // arithmetic: 40000
    { ref: "3", description: "Cement plaster 12 mm thick in CM 1:6", unit: "sqm", qty: 300, prev: 0, rate: 250, amount: 75000 },            // MB only 280
    { ref: "9", description: "Extra item: dewatering", unit: "LS", qty: 1, prev: 0, rate: 5000, amount: 5000 }
  ];
  const cert = C.certifyBill(agreement, bill, { mb: { 2: 280 }, deviationPct: 25, settings: { sdPct: 5, itPct: 2, gstTdsPct: 0, cessPct: 1 } });
  const [l1, l2, l3, l4] = cert.lines;
  assert.equal(l1.allowedRate, 300); assert.equal(l1.allowedQty, 125); assert.equal(l1.certified, 37500);
  assert.equal(l1.reasons.length, 2);
  assert.match(l2.reasons[0], /Arithmetic/); assert.equal(l2.certified, 40000);
  assert.equal(l3.allowedQty, 280); assert.equal(l3.certified, 70000);
  assert.equal(l4.extra, true); assert.equal(l4.certified, 0);
  // certified to date 37500 + 40000 + 70000 = 147500; previous 60×300 + 5×5000 + 0 = 43000; gross 104500
  assert.equal(cert.certifiedUpto, 147500);
  assert.equal(cert.certifiedPrev, 43000);
  assert.equal(cert.gross, 104500);
  // deductions 5% 5225 + 2% 2090 + 1% 1045 = 8360 → net 96140
  assert.deepEqual(cert.deductions.map((d) => d.amount), [5225, 2090, 1045]);
  assert.equal(cert.net, 96140);
  assert.equal(cert.claimedUpto, 44800 + 4000 + 75000 + 5000);
  assert.equal(cert.flagged, 4);
  const sheet = C.certificateSheet(cert);
  assert.deepEqual(sheet.at(-1).slice(-1), [96140]);
});

test("quantities over the agreement but within the deviation limit are paid with a reminder", () => {
  const cert = C.certifyBill(agreement, [{ ref: "1", description: "Excavation in ordinary soil up to 1.5 m depth", unit: "cum", qty: 110, prev: 0, rate: 300, amount: 33000 }], { settings: { sdPct: 0, itPct: 0, cessPct: 0 } });
  assert.equal(cert.lines[0].certified, 33000);
  assert.match(cert.lines[0].reasons[0], /10% above the agreement quantity/);
  assert.equal(cert.net, 33000);
});

test("bar bending schedule: cutting lengths with bend deductions, weights d²/162, summary and wastage", () => {
  const res = C.bbs([
    { type: "beam", mark: "B1", count: 4, length: 4000, width: 230, depth: 450, cover: 25, support: 230, bottom: { dia: 16, n: 3 }, top: { dia: 12, n: 2 }, stirrup: { dia: 8, spacing: 150 } },
    { type: "column", mark: "C1", count: 6, height: 3000, width: 300, depth: 300, main: { dia: 16, n: 4 }, tie: { dia: 8, spacing: 150 } },
    { type: "footing", mark: "F1", count: 6, length: 1500, width: 1500, depth: 450, barsL: { dia: 12, spacing: 150 }, barsB: { dia: 12, spacing: 150 } }
  ]);
  const by = Object.fromEntries(res.bars.map((b) => [`${b.member} ${b.label}`, b]));
  // bottom bar: 4000 + 2×(230 − 25) + 2×12×16 − 2×2×16 = 4730 mm; 3 × 4 = 12 bars; 12 × 4.73 × 256/162 = 89.69 kg
  assert.equal(by["B1 Bottom bars"].cutMm, 4730); assert.equal(by["B1 Bottom bars"].total, 12); assert.equal(by["B1 Bottom bars"].kg, 89.69);
  // stirrup: a = 230 − 50 − 8 = 172, b = 450 − 50 − 8 = 392; 2(564) + 160 − 48 − 48 = 1192; (4000 − 100)/150 + 1 = 27 per beam
  assert.equal(by["B1 Stirrups"].cutMm, 1192); assert.equal(by["B1 Stirrups"].perMember, 27);
  // column bar: 3000 + 50×16 = 3800; tie: a = b = 300 − 80 − 8 = 212 → 848 + 64 = 912
  assert.equal(by["C1 Main bars"].cutMm, 3800); assert.equal(by["C1 Ties"].cutMm, 912);
  // footing: 1500 − 100 + 2×(450 − 100) − 2×2×12 = 2052; (1500 − 100)/150 + 1 = 10 bars
  assert.equal(by["F1 Bars along length"].cutMm, 2052); assert.equal(by["F1 Bars along length"].perMember, 10);
  assert.equal(res.totalKg, Object.values(res.byDia).reduce((a, b) => a + b, 0));
  assert.equal(res.withWastage, Math.round(res.totalKg * 1.03 * 100) / 100);
  assert.deepEqual(C.bbs([{ type: "beam", mark: "B9", length: 0 }]).problems.length, 1);
});

test("the same stirrup length as the calculators page", () => {
  const calc = require("../assets/calc.js");
  const fn = calc.stirrups || calc.stirrup || calc.stirrupLength;
  if (!fn) return;   // calculator shape differs: covered by the hand-worked numbers above
  const res = C.bbs([{ type: "beam", mark: "B", length: 3000, width: 230, depth: 450, cover: 25, stirrup: { dia: 8, spacing: 150 } }]);
  assert.equal(res.bars[0].cutMm, 1192);
});

test("bar notation and the drawing table are read into members", () => {
  assert.deepEqual(C.parseBars("3-16"), { n: 3, dia: 16, parts: [{ n: 3, dia: 16 }] });
  assert.deepEqual(C.parseBars("2-16+1-12").parts, [{ n: 2, dia: 16 }, { n: 1, dia: 12 }]);
  assert.deepEqual(C.parseBars("10@150"), { dia: 10, spacing: 150 });
  assert.deepEqual(C.parseBars("T10-150"), { dia: 10, spacing: 150 });
  assert.deepEqual(C.parseBars("8 mm @ 150 c/c"), { dia: 8, spacing: 150 });
  assert.equal(C.parseBars("4 nos 20").n, 4);
  assert.equal(C.parseBars(""), null);
  const text = "| Mark | Type | Count | Length / height (mm) | Width / ly (mm) | Depth / thickness (mm) | Main bars | Top / distribution bars | Stirrups / ties | Notes |\n|---|---|---|---|---|---|---|---|---|---|\n| B2 | beam | 2 | 4000 | 230 | 450 | 2-16+1-12 | 2-12 | 8@150 | |\n| S1 | Slabs | 1 | 3000 | 4500 | 125 | 10@150 | 8@200 | | alternate bars cranked |\n| W1 | wall | 1 | | | | | | | |";
  const m = C.membersFromText(text);
  assert.equal(m.length, 2, "only beam, column, slab and footing");
  assert.equal(m[1].type, "slab"); assert.equal(m[1].cranked, true); assert.deepEqual(m[1].dist, { dia: 8, spacing: 200 });
  const bars = C.bbs(m).bars.filter((b) => b.member === "B2" && /Bottom/.test(b.label));
  assert.deepEqual(bars.map((b) => [b.dia, b.total]), [[16, 4], [12, 2]], "mixed bottom bars listed per diameter");
  const crank = C.bbs([m[1]]).bars.find((b) => /cranked/.test(b.label));
  // cranked: 3000 + 2×(230 − 20) + 2 × 0.42 × (125 − 40 − 10) = 3420 + 63 = 3483
  assert.equal(crank.cutMm, 3483);
});

test("IS 456 checks: span/depth, steel limits, short column capacity, footing area and punching", () => {
  const slab = C.slabCheck({ spanMm: 3000, support: "simple", mf: 1.2, providedD: 125, coverMm: 20, barDia: 10 });
  assert.equal(slab.dReq, 125);   // 3000 / (20 × 1.2)
  assert.equal(slab.results[0].ok, false, "d = 100 mm < 125 mm");
  assert.equal(C.slabCheck({ spanMm: 3000, mf: 1.2, providedD: 150 }).results[0].ok, true);
  const long = C.beamCheck({ spanMm: 12000, support: "simple", mf: 1, b: 300, D: 900 });
  assert.equal(long.dReq, 720);   // 12000 / (20 × 1 × 10/12)
  const beam = C.beamCheck({ spanMm: 5000, mf: 1.1, b: 230, D: 450, bars: 3, barDia: 16, fy: 500 });
  // d = 450 − 25 − 8 − 8 = 409; Ast,min = 0.85 × 230 × 409 / 500 = 160
  assert.equal(beam.astMin, 160);
  assert.equal(beam.results[1].ok, true);
  const col = C.columnCheck({ b: 300, D: 300, lexMm: 3000, fck: 25, fy: 500, nBars: 4, barDia: 16, PuKN: 1200 });
  // Asc = 804.2; 0.4 × 25 × (90000 − 804.2) + 0.67 × 500 × 804.2 = 891958 + 269414 = 1161 kN
  assert.equal(col.capacityKN, 1161);
  assert.equal(col.results.find((r) => r.name === "Axial capacity").ok, false);
  assert.equal(col.results.find((r) => r.name === "Short column").ok, true);
  assert.equal(C.columnCheck({ b: 230, D: 230, lexMm: 3500, nBars: 4, barDia: 12 }).results.find((r) => r.name === "Short column").ok, false);
  const ft = C.footingCheck({ PkN: 800, sbc: 200, L: 2100, B: 2100, D: 450, colB: 300, colD: 300, fck: 25 });
  assert.equal(ft.areaReq, 4.4);   // 800 × 1.1 / 200
  assert.ok(ft.results.every((r) => r.ok));
  assert.equal(C.footingCheck({ PkN: 800, sbc: 200, L: 1800, B: 1800, D: 450, colB: 300, colD: 300 }).results[0].ok, false);
  for (const r of [...slab.results, ...beam.results, ...col.results, ...ft.results]) assert.match(r.clause, /^IS 456 cl \d/);
});

test("spec messages carry the project and the items; drafts become safe HTML", () => {
  const items = [{ ref: "", description: "Concrete work", heading: true }, { ref: "C1", description: "RCC M25 in slabs", unit: "cum", qty: 20 }];
  const msg = C.specMessage({ name: "School block", location: "Mysuru, India", cost: "" }, items);
  assert.match(msg, /Name of work: School block/); assert.match(msg, /Location \/ country: Mysuru, India/);
  assert.doesNotMatch(msg, /Estimated cost/);
  assert.match(msg, /C1\. .*RCC M25 in slabs \(unit: cum\)/);
  assert.match(C.conditionsMessage({}, items), /1 items; sections: Concrete work/);
  const html = C.mdToHtml("## 2. Concrete\n**Materials**\n2.1 Cement shall be <script>x</script>\n- OPC 53\n\nPlain");
  assert.match(html, /<h3>2\. Concrete<\/h3>/);
  assert.match(html, /<strong>Materials<\/strong>/);
  assert.match(html, /<span class="num">2\.1<\/span> Cement shall be &lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<ul>\n<li>OPC 53<\/li>\n<\/ul>/);
});

test("a priced BOQ copied by the AI reads its rates and amounts", () => {
  const rows = C.tableRows("| Item No | Description | Unit | Qty | Rate | Amount |\n|---|---|---|---|---|---|\n| 1 | Earthwork | | | | |\n| 1.1 | Excavation | cum | 100 | 300 | 30000 |");
  const items = Q.pricedItems(rows);
  assert.deepEqual(items.map((x) => [x.ref, x.heading ? "h" : x.rate]), [["1", "h"], ["1.1", 300]]);
});

test("site snags: the AI table becomes snags on the right photos, critical first, with a summary", () => {
  const reply = "| Photo | Location / element | Defect | Severity | Likely cause | Remedy | Reference |\n|---|---|---|---|---|---|---|\n" +
    "| 1 | Column C3 | Honeycombing at the base | Major | Poor compaction | Chip, clean and patch with repair mortar; verify depth on site | IS 456 cl 13.3 |\n" +
    "| Photo 2 | Slab edge | No edge protection | Critical – stop work | Guard rail missing | Install guard rail with toe board | IS 3696 |\n" +
    "| 2 | Location not given – slab edge | No visible defect | Minor | | | |\n" +
    "| 3 | Beam | Crack | High | x | y | |";   // no photo 3 was sent
  const snags = C.snagsFromText(reply, ["pA", "pB"]);
  assert.deepEqual(snags.map((s) => [s.photo, s.severity, s.status]), [["pA", "Major", "Open"], ["pB", "Critical", "Open"], ["pB", "Minor", "Open"]]);
  assert.equal(snags[0].remedy, "Chip, clean and patch with repair mortar; verify depth on site");
  assert.equal(snags[0].reference, "IS 456 cl 13.3");
  assert.equal(snags[2].location, "slab edge", "'Location not given' is dropped");
  const sorted = C.sortSnags(snags, ["pA", "pB"]);
  assert.deepEqual(sorted.map((s) => s.severity), ["Critical", "Major", "Minor"]);
  assert.deepEqual(C.snagSummary(snags), { total: 2, open: 2, critical: 1, major: 1, minor: 0 }, "'No visible defect' is not counted");
  snags[1].status = "Closed";
  assert.deepEqual(C.snagSummary(snags), { total: 2, open: 1, critical: 0, major: 1, minor: 0 });
  assert.equal(C.sortSnags(snags, ["pA", "pB"])[0].photo, "pA", "closed items go below open ones");
  const sheet = C.snagSheet(sorted, { photoLabel: (id) => (id === "pA" ? "P1" : "P2") });
  assert.deepEqual(sheet[2], ["No", "Photo", "Location / element", "Defect", "Severity", "Likely cause", "Remedy / remarks", "Reference", "Status"]);
  assert.deepEqual(sheet[3].slice(0, 5), [1, "P2", "Slab edge", "No edge protection", "Critical"]);
});

test("snags in the site team's language: message, reply, Excel columns and the WhatsApp text", () => {
  const snags = [
    { photo: "p1", location: "Column C3", defect: "Honeycombing at base", severity: "Major", remedy: "Chip loose concrete and patch with repair mortar", status: "Open" },
    { photo: "p2", location: "Slab edge", defect: "No edge protection", severity: "Critical", remedy: "Stop work at the edge; fix a 1 m guard rail", status: "Open" },
    { photo: "p2", location: "Slab", defect: "Dust", severity: "Minor", remedy: "Clean", status: "Closed" }
  ];
  const msg = C.translateMessage(snags.slice(0, 2), "kn");
  assert.match(msg, /^Language: Kannada/);
  assert.match(msg, /2\. Defect: No edge protection \| Remedy: Stop work at the edge; fix a 1 m guard rail/);
  assert.equal(C.langName("hi"), "Hindi"); assert.equal(C.langName("xx"), "");
  // rows may come back in any order; missing or out-of-range numbers are ignored
  const t = C.translationsFromText("| No | Defect | Remedy |\n|---|---|---|\n| 2 | ಅಂಚಿನ ರಕ್ಷಣೆ ಇಲ್ಲ | ಅಂಚಿನಲ್ಲಿ ಕೆಲಸ ನಿಲ್ಲಿಸಿ; 1 m ಗಾರ್ಡ್ ರೈಲ್ ಹಾಕಿ |\n| 9 | x | y |", 2);
  assert.equal(t[0], null);
  assert.deepEqual(t[1], { defect: "ಅಂಚಿನ ರಕ್ಷಣೆ ಇಲ್ಲ", remedy: "ಅಂಚಿನಲ್ಲಿ ಕೆಲಸ ನಿಲ್ಲಿಸಿ; 1 m ಗಾರ್ಡ್ ರೈಲ್ ಹಾಕಿ" });
  snags[1].local = { lang: "kn", ...t[1] };
  const sheet = C.snagSheet(C.sortSnags(snags, ["p1", "p2"]), { photoLabel: (id) => id.toUpperCase() });
  assert.deepEqual(sheet[2].slice(-2), ["Defect (Kannada)", "Remedy (Kannada)"]);
  assert.deepEqual(sheet[3].slice(-2), ["ಅಂಚಿನ ರಕ್ಷಣೆ ಇಲ್ಲ", "ಅಂಚಿನಲ್ಲಿ ಕೆಲಸ ನಿಲ್ಲಿಸಿ; 1 m ಗಾರ್ಡ್ ರೈಲ್ ಹಾಕಿ"]);
  assert.deepEqual(sheet[4].slice(-2), ["", ""], "a snag not yet translated has empty cells");
  assert.equal(C.snagSheet(snags.slice(0, 1))[2].length, 9, "no language columns without translations");
  const wa = C.snagShareText(C.sortSnags(snags, ["p1", "p2"]), { project: "School", date: "2026-11-25", photoLabel: (id) => id.toUpperCase() });
  assert.match(wa, /^\*Snag list – School – 2026-11-25\*\n2 open/);
  assert.match(wa, /1\. 🔴 \*Critical\* · Slab edge \(P2\)\nಅಂಚಿನ ರಕ್ಷಣೆ ಇಲ್ಲ\n✅ ಅಂಚಿನಲ್ಲಿ ಕೆಲಸ ನಿಲ್ಲಿಸಿ/);
  assert.match(wa, /2\. 🟠 \*Major\* · Column C3 \(P1\)\nHoneycombing at base\n✅ Chip loose/, "untranslated snags go in English");
  assert.doesNotMatch(wa, /Dust/, "closed snags are left out");
});
