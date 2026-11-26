"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../assets/quote.js");

const BOQ = `## BOQ — ground floor slab
| Sl. No. | Description | Unit | Qty | Rate (₹) | Amount (₹) |
|---|---|---|---|---|---|
| 1 | **M25 RMC incl. pumping** | m³ | 12.5 | 6,250 | 78,125 |
| 2 | TMT steel Fe500D | kg | 1,200 | 72.50 | 87,000 |
| 3 | Shuttering | sq m | 80 | — | 36,000 |
| | **Subtotal** | | | | **2,01,125** |
| | GST 18% | | | | 36,202 |
| | **Grand Total** | | | | **2,37,327** |`;

test("items come from the BOQ table; serial, subtotal, GST and total rows are skipped", () => {
  const items = Q.itemsFromAnswer(BOQ);
  assert.deepEqual(items, [
    { description: "M25 RMC incl. pumping", unit: "m³", qty: 12.5, rate: 6250 },
    { description: "TMT steel Fe500D", unit: "kg", qty: 1200, rate: 72.5 },
    { description: "Shuttering", unit: "sq m", qty: 80, rate: 450 }   // rate worked back from the amount
  ]);
  assert.equal(Q.detectCurrency(BOQ), "INR");
});

test("an amount-only table becomes qty 1 lines; AED is detected", () => {
  const text = "Costs in AED:\n| Item | Amount (AED) |\n|---|---|\n| Gypsum ceiling | 4,500 |\n| Painting | 2,250.50 |\n| Total | 6,750.50 |";
  assert.deepEqual(Q.itemsFromAnswer(text), [
    { description: "Gypsum ceiling", unit: "", qty: 1, rate: 4500 },
    { description: "Painting", unit: "", qty: 1, rate: 2250.5 }
  ]);
  assert.equal(Q.detectCurrency(text), "AED");
});

test("tables without a rate or amount give no quotation", () => {
  assert.deepEqual(Q.itemsFromAnswer("| Grade | Cement kg |\n|---|---|\n| M20 | 340 |"), []);
  assert.deepEqual(Q.itemsFromAnswer("No table here."), []);
});

test("the priced table is chosen when an answer has several", () => {
  const text = "| Parameter | Value |\n|---|---|\n| w/c | 0.45 |\n\n| Item | Qty | Rate | Amount |\n|---|---|---|---|\n| Blockwork 200 mm | 50 | 95 | 4750 |";
  assert.deepEqual(Q.itemsFromAnswer(text), [{ description: "Blockwork 200 mm", unit: "", qty: 50, rate: 95 }]);
});

test("totals: discount before tax, GST on the taxable amount", () => {
  const t = Q.totals({ items: Q.itemsFromAnswer(BOQ), discount: 1125, taxRate: 18 });
  assert.equal(t.subtotal, 201125);
  assert.equal(t.taxable, 200000);
  assert.equal(t.tax, 36000);
  assert.equal(t.total, 236000);
  assert.equal(Q.totals({ items: [{ qty: 1, rate: 100 }], discount: 500 }).total, 0, "discount is capped at the subtotal");
});

test("amount in words: Indian lakh/crore for rupees, thousands for dirhams", () => {
  assert.equal(Q.amountInWords(236000, "INR"), "Rupees Two Lakh Thirty-Six Thousand Only");
  assert.equal(Q.amountInWords(12345678.5, "INR"), "Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Fifty Paise Only");
  assert.equal(Q.amountInWords(4725, "AED"), "UAE Dirhams Four Thousand Seven Hundred Twenty-Five Only");
  assert.equal(Q.amountInWords(1001.25, "OMR"), "Omani Rials One Thousand One and Two Hundred Fifty Baisa Only");
});

test("money formats rupees the Indian way and writes Rs. for the PDF", () => {
  assert.equal(Q.money(236000, "INR"), "₹ 2,36,000.00");
  assert.equal(Q.money(236000, "INR", { pdf: true }), "Rs. 2,36,000.00");
  assert.match(Q.money(4725, "AED"), /^AED 4,725\.00$/);
});

test("WhatsApp text lists every item, the tax and the total in words", () => {
  const text = Q.shareText({ number: "Q-20261119-01", date: "2026-11-19", currency: "INR", taxRate: 18, discount: 1125,
    items: Q.itemsFromAnswer(BOQ), client: { name: "Ravi" }, company: { name: "ABC Builders", phone: "+91 98000 00000" }, terms: "50% advance" });
  assert.match(text, /^\*QUOTATION Q-20261119-01\*/);
  assert.match(text, /ABC Builders/);
  assert.match(text, /To: Ravi/);
  assert.match(text, /3\. Shuttering\n {3}80 sq m × ₹ 450\.00 = \*₹ 36,000\.00\*/);
  assert.match(text, /GST 18%: ₹ 36,000\.00/);
  assert.match(text, /\*TOTAL: ₹ 2,36,000\.00\*\n\(Rupees Two Lakh Thirty-Six Thousand Only\)/);
  assert.match(text, /Terms:\n50% advance/);
});

test("quotation numbers carry the date and a 2-digit sequence", () => {
  assert.equal(Q.quoteNumber(new Date("2026-11-19T10:00:00Z"), 3), "Q-20261119-03");
});

test("a sectioned full BOQ: headings and section sub-totals are skipped, the summary table is ignored", () => {
  const text = `| Sl. No. | Description | Unit | Qty | Preliminary Market Rate (₹) | Amount (₹) |
|---|---|---|---|---|---|
| **A** | **Earthwork** | | | | |
| A1 | Excavation in ordinary soil | m³ | 95 | 280 | 26,600 |
| A2 | Backfilling | m³ | 40 | 160 | 6,400 |
| | **Sub-total A** | | | | **33,000** |
| **C** | **RCC work** | | | | |
| C1 | M20 concrete in footings | m³ | 8.5 | 7,200 | 61,200 |
| | Sub-total C | | | | 61,200 |

| Section | Amount (₹) |
|---|---|
| A Earthwork | 33,000 |
| C RCC | 61,200 |
| **Grand Total** | **94,200** |`;
  const items = Q.itemsFromAnswer(text);
  assert.deepEqual(items.map((i) => i.description), ["Excavation in ordinary soil", "Backfilling", "M20 concrete in footings"]);
  assert.equal(Q.totals({ items }).subtotal, 94200);
});

// ---------- tender BOQs ----------
const GEPNIC = [
  ["Tender Inviting Authority: Executive Engineer"], ["Name of Work: Construction of Anganwadi Centre"], [],
  ["Sl. No.", "Item Description", "Quantity", "Units", "BASIC RATE In Figures To be entered by the Bidder in Rs. P", "TOTAL AMOUNT With Taxes", "TOTAL AMOUNT In Words"],
  [1, 2, 3, 4, 5, 6, 7],
  ["1", "Earth work in excavation by mechanical means (Hydraulic excavator) / manual means over areas, including disposal of excavated earth, lead up to 50 m and lift up to 1.5 m", "", "", "", "", ""],
  ["1.1", "All kinds of soil", 125.5, "cum", "", "", ""],
  ["1.2", "Ordinary rock", "12.00", "cum", "", "", ""],
  ["2", "Providing and laying in position cement concrete of specified grade excluding the cost of centering and shuttering - All work up to plinth level : 1:4:8 (1 Cement : 4 coarse sand : 8 graded stone aggregate 40 mm nominal size)", 18.2, "cum", "", "", ""],
  ["", "Total in Figures", "", "", "", "", ""],
  ["", "Quoted Rate in Figures", "", "", "", "", ""]
];

test("government e-tender BOQ sheet: item numbers, full descriptions, units, quantities; headings kept, number row and totals skipped", () => {
  const items = Q.tenderItems(GEPNIC);
  assert.deepEqual(items.map((i) => [i.ref, i.heading ? "H" : `${i.qty} ${i.unit}`]), [["1", "H"], ["1.1", "125.5 cum"], ["1.2", "12 cum"], ["2", "18.2 cum"]]);
  assert.match(items[3].description, /^Providing and laying in position cement concrete .* 40 mm nominal size\)$/);
  assert.equal(items[1].rate, 0);
  assert.equal(Q.totals({ items: items.map((i) => (i.heading ? i : { ...i, rate: 100 })) }).subtotal, 15570);
});

test("a BOQ the AI copied from a PDF (Markdown) becomes the same items", () => {
  const text = "| Item No | Description | Unit | Qty |\n|---|---|---|---|\n| 5.1 | Brick work with common burnt clay bricks in: | | |\n| 5.1.1 | Cement mortar 1:6 | cum | 42.75 |\n| 5.1.2 | Cement mortar 1:4 | cum | 3 |";
  const items = Q.tenderItemsFromText(text);
  assert.deepEqual(items.map((i) => i.ref), ["5.1", "5.1.1", "5.1.2"]);
  assert.equal(items[0].heading, true);
  assert.equal(items[1].qty, 42.75);
});

test("rate requests: priced items only, numbered, with the parent heading for short sub-items, 40 per request", () => {
  const items = Q.tenderItems(GEPNIC);
  const [req] = Q.rateRequests(items, { location: "Mysuru", currency: "INR", month: "November 2026" });
  assert.deepEqual(req.indexes, [1, 2, 3]);
  assert.match(req.message, /^Site location: Mysuru\. Currency: INR\. Month: November 2026\./);
  assert.match(req.message, /\n1\. \[1\.1\] Earth work in excavation .* — All kinds of soil \(unit: cum, qty: 125\.5\)/);
  const many = Array.from({ length: 95 }, (_, i) => ({ ref: String(i + 1), description: `Item ${i}`, unit: "m", qty: 1, rate: 0 }));
  assert.deepEqual(Q.rateRequests(many).map((r) => r.indexes.length), [40, 40, 15]);
  const onlyEmpty = Q.rateRequests([{ description: "a", qty: 1, rate: 50 }, { description: "b", qty: 1, rate: 0 }], { want: (it) => !(it.rate > 0) });
  assert.deepEqual(onlyEmpty[0].indexes, [1]);
});

test("rates come back in item order; missing or bad rows stay empty", () => {
  const reply = "| No | Rate | Basis |\n|---|---|---|\n| 1 | 285 | excavator + tipper |\n| 3 | 6,480.50 | M7.5 PCC |\n| 9 | 10 | out of range |";
  const r = Q.ratesFromText(reply, 3);
  assert.equal(r[0], 285); assert.ok(Number.isNaN(r[1])); assert.equal(r[2], 6480.5);
});

test("WhatsApp text uses the tender item numbers and shows headings", () => {
  const text = Q.shareText({ number: "Q-1", currency: "INR", items: Q.tenderItems(GEPNIC).map((i) => (i.heading ? i : { ...i, rate: 100 })) });
  assert.match(text, /\*1 Earth work in excavation/);
  assert.match(text, /\n1\.1\. All kinds of soil\n {3}125\.5 cum × ₹ 100\.00/);
});

// ---------- check before submitting ----------
function tenderQuote() {
  const items = Q.tenderItems(GEPNIC).map((it) => ({ ...it, orig: { qty: it.qty, unit: it.unit, description: it.description } }));
  return { fromTender: true, tenderRefs: items.map((i) => i.ref), date: "2026-11-24", validUntil: "2027-02-22", company: { name: "SV Smart Building", phone: "90000" }, client: { name: "EE, PWD" }, items };
}
test("check: a complete, untouched tender quote has no issues", () => {
  const q = tenderQuote(); q.items.forEach((it) => { if (!it.heading) it.rate = 100; });
  assert.deepEqual(Q.checkQuote(q), []);
});
test("check: missing rates, changed quantity, dropped item, AI rates, extra item, short validity — red first", () => {
  const q = tenderQuote();
  q.items[1].rate = 285; q.items[1].aiRate = true;       // 1.1
  q.items[3].rate = 6480; q.items[3].qty = 15;           // 2: qty changed
  q.items.splice(2, 1);                                  // 1.2 dropped
  q.items.push({ ref: "X1", description: "Extra cleaning", unit: "LS", qty: 1, rate: 500 });
  q.validUntil = "2026-12-10";
  const issues = Q.checkQuote(q), text = issues.map((i) => `${i.level}: ${i.text}`).join("\n");
  assert.match(text, /^red: .*Quantity changed from the tender for 2 \(18\.2 → 15\)/m);
  assert.match(text, /^red: Tender item missing from your quote: 1\.2\./m);
  assert.match(text, /^amber: 1 item is not in the tender: X1/m);
  assert.match(text, /^amber: 1 rate is still the AI suggestion \(1\.1\)/m);
  assert.match(text, /^amber: The quote is valid for less than 30 days/m);
  assert.equal(issues[0].level, "red");
  assert.ok(issues.findIndex((i) => i.level === "amber") > issues.findLastIndex((i) => i.level === "red"));
  const empty = tenderQuote();
  assert.match(Q.checkQuote(empty)[0].text, /^3 items have no rate: 1\.1, 1\.2, 2\./);
});
test("review message for the AI carries terms, tax, validity, items and the automatic findings", () => {
  const q = { ...tenderQuote(), currency: "INR", taxLabel: "GST", taxRate: 18, terms: "50% advance", tenderTerms: "**Money**\n- Rates must include all taxes except GST" };
  q.items.forEach((it) => { if (!it.heading) it.rate = 100; });
  q.items[1].short = "Dig any soil by machine, lead 50 m, lift 1.5 m; per cum.";
  const m = Q.reviewMessage(q, [{ level: "amber", text: "Your phone is missing." }]);
  assert.match(m, /Rates must include all taxes except GST/);
  assert.match(m, /GST 18% added on top; discount 0; quote valid 90 days/);
  assert.match(m, /\n1\.1 \| Dig any soil by machine, lead 50 m, lift 1\.5 m; per cum\. \| cum \| 125\.5 \| 100 \| 12550/);
  assert.match(m, /do not repeat\): Your phone is missing\./);
});
test("simplify requests and short lines", () => {
  const [r] = Q.simplifyRequests(Q.tenderItems(GEPNIC));
  assert.match(r.message, /^Explain each tender item in short, simple words\.\nItems:\n1\. \[1\.1\]/);
  assert.deepEqual(Q.shortsFromText("| No | In short |\n|---|---|\n| 2 | Rock digging, per cum |", 3), [undefined, "Rock digging, per cum", undefined]);
});

// ---------- my rate book ----------
test("units with different spellings match", () => {
  assert.deepEqual(["Cum", "m³", "M3", "cu.m"].map(Q.normUnit), ["m3", "m3", "m3", "m3"]);
  assert.deepEqual(["Sqm", "m²", "sq.m"].map(Q.normUnit), ["m2", "m2", "m2"]);
  assert.deepEqual(["RMT", "Rm", "metre"].map(Q.normUnit), ["m", "m", "m"]);
  assert.deepEqual(["Nos.", "each", "No"].map(Q.normUnit), ["no", "no", "no"]);
});

test("saving a quote's rates: checked rates only, sub-items with their parent, updates keep history", () => {
  const items = Q.tenderItems(GEPNIC).map((it) => (it.heading ? it : { ...it, rate: it.ref === "1.1" ? 290 : it.ref === "1.2" ? 1500 : 6500 }));
  items[2].aiRate = true;                                             // 1.2 is an unchecked AI rate
  const first = Q.addToRateBook([], { number: "Q-1", currency: "INR", items }, "2026-11-24");
  assert.equal(first.added, 2);
  assert.deepEqual(first.book.map((e) => [e.id, e.unit, e.rate]), [["R1", "cum", 290], ["R2", "cum", 6500]]);
  assert.match(first.book[0].description, /^Earth work in excavation .* — All kinds of soil$/);
  items[1].rate = 310;
  const second = Q.addToRateBook(first.book, { number: "Q-2", currency: "INR", items }, "2026-12-01");
  assert.equal(second.updated, 1); assert.equal(second.added, 0);
  assert.deepEqual(second.book[0].history, [{ rate: 290, date: "2026-11-24", from: "Q-1" }]);
  assert.equal(second.book[0].rate, 310);
  assert.equal(first.book[0].rate, 290, "the old book is not changed");
});

test("own rates: same work is used directly; similar work is offered to the AI; other currency or unit is ignored", () => {
  const { book } = Q.addToRateBook([], { currency: "INR", items: [
    { description: "Machine batched M-25 RCC up to plinth level including pumping, excluding shuttering and reinforcement", unit: "cum", qty: 1, rate: 7900 },
    { description: "12 mm cement plaster of mix 1:6", unit: "sqm", qty: 1, rate: 280 }] });
  assert.equal(Q.ownRateFor({ description: "Machine batched M-25 RCC up to plinth level including pumping, excluding shuttering and reinforcement.", unit: "m³" }, book).id, "R1");
  assert.equal(Q.ownRateFor({ description: "Machine batched M-30 RCC in slabs above plinth including pumping", unit: "cum" }, book), null);
  assert.deepEqual(Q.similarRates({ description: "Machine batched M-30 RCC in slabs above plinth including pumping", unit: "cum" }, book).map((x) => x.entry.id), ["R1"]);
  assert.deepEqual(Q.similarRates({ description: "12 mm cement plaster of mix 1:6", unit: "cum" }, book), [], "different unit");
  assert.deepEqual(Q.similarRates({ description: "12 mm cement plaster of mix 1:6", unit: "sqm" }, book, { currency: "AED" }), [], "different currency");
  const [req] = Q.rateRequests([{ ref: "5.33.2", description: "Machine batched M-30 RCC in slabs above plinth including pumping", unit: "cum", qty: 40, rate: 0 }], { location: "Pune", book });
  assert.match(req.message, /\n {3}Your rates for similar work: R1 = 7900 per cum \(Machine batched M-25 RCC/);
  assert.deepEqual(Q.sourcesFromText("| No | Rate | Source | Basis |\n|---|---|---|---|\n| 1 | 8400 | R1 adjusted | M30 + slab |", 1), ["R1 adjusted"]);
});

test("rate list from Excel: description, unit and rate columns", () => {
  const list = Q.rateListFromRows([["My rate list 2026"], ["S.No", "Item", "Unit", "Rate (Rs)"], [1, "PCC 1:4:8", "cum", "6,200"], [2, "Brick work 1:6", "cum", 7800], [3, "Note: rates excl GST", "", ""]], "INR", "2026-11-24");
  assert.deepEqual(list.map((x) => [x.description, x.unit, x.rate]), [["PCC 1:4:8", "cum", 6200], ["Brick work 1:6", "cum", 7800]]);
});

// ---------- bid summary ----------
test("figures are read from the key tender terms", () => {
  const f = Q.termsFacts("**Money**\n- Estimated cost put to tender: Rs. 48.6 lakh.\n- EMD Rs. 97,200.\n- Performance security 5% of the tendered value.\n- Security deposit 2.5% recovered from each running bill.\n**Work & time**\n- Complete in 6 (six) months.\n- Offer valid for 120 days.\n**Penalties**\n- 0.5% per week of delay, max 10%.");
  assert.deepEqual({ ...f, emdPct: undefined }, { estimate: 4860000, emd: 97200, emdPct: undefined, perfPct: 5, retentionPct: 2.5, months: 6, validityDays: 120, ldPctPerWeek: 0.5 });
  assert.equal(Q.termsFacts("Estimated cost Rs 2.5 crore. EMD 2% of estimated cost.").emd, 500000);
  assert.deepEqual(Q.termsFacts(""), { estimate: undefined, emd: undefined, emdPct: undefined, perfPct: undefined, retentionPct: undefined, months: undefined, validityDays: undefined, ldPctPerWeek: undefined });
});

test("bid summary: profit, money locked up, peak cash and plain warnings", () => {
  const q = { items: [{ qty: 1, rate: 4860000 }], taxRate: 0 };
  const r = Q.bidSummary(q, { profitPct: 12, estimate: 4860000, emd: 97200, perfPct: 5, retentionPct: 2.5, months: 6, payDays: 45 });
  assert.equal(Math.round(r.cost), 4339286);
  assert.equal(Math.round(r.profit), 520714);
  assert.equal(r.margin.toFixed(1), "10.7");
  assert.equal(r.vsEstimate, 0);
  assert.equal(Math.round(r.perfSec), 243000);
  assert.equal(Math.round(r.workingCap), 1808036);    // 6 months of cost, paid 45 days late → 2.5 months of spend
  assert.equal(Math.round(r.peak), 2172536);
  const thin = Q.bidSummary(q, { profitPct: 3, estimate: 4000000, months: 6 });
  assert.match(thin.flags.map((f) => f.text).join(" "), /Profit is thin \(2\.9%\).*21\.5% above the department's estimate/);
  assert.equal(Q.bidSummary(q, { cost: 5000000 }).flags[0].level, "red");
  assert.match(Q.bidSummary(q, { profitPct: 15, estimate: 6000000 }).flags.map((f) => f.text).join(" "), /19\.0% below the estimate/);
});

test("a heading is only a parent for its own sub-items (by item number)", () => {
  const items = [{ ref: "1", description: "Earth work in excavation by mechanical means", heading: true }, { ref: "1.1", description: "All kinds of soil", unit: "cum", qty: 5 },
    { ref: "", description: "Machine batched M-30 RCC in slabs", unit: "cum", qty: 4 }, { ref: "2", description: "Brick work", unit: "cum", qty: 3 }];
  assert.equal(Q.fullDescription(items, 1), "Earth work in excavation by mechanical means — All kinds of soil");
  assert.equal(Q.fullDescription(items, 2), "Machine batched M-30 RCC in slabs");
  assert.equal(Q.fullDescription(items, 3), "Brick work");
});

// ---------- my material prices ----------
const PRICE_REPLY = "Supplier: Sri Ganesh Traders, Mysuru\nList date: 2026-10-15\n\n| Item | Make | Size / Model | Unit | Price | Price basis |\n|---|---|---|---|---|---|\n| OPC 43 grade cement | UltraTech | 50 kg | bag | 380 | net excl GST |\n| Coarse sand (river) | - | zone II | cum | 2,800 | delivered |\n| TMT bar Fe-500D | TATA Tiscon | 12 mm | kg | 68.50 | net excl GST |\n| Wall putty | Birla White | 40 kg | bag | 950 | MRP incl GST |";

test("a catalogue copied by the AI: supplier, date and every priced product", () => {
  const r = Q.materialsFromText(PRICE_REPLY);
  assert.equal(r.supplier, "Sri Ganesh Traders, Mysuru"); assert.equal(r.listDate, "2026-10-15");
  assert.deepEqual(r.list.map((m) => [Q.matLabel(m), m.unit, m.price, m.priceBasis]), [
    ["UltraTech OPC 43 grade cement 50 kg", "bag", 380, "net excl GST"], ["Coarse sand (river) zone II", "cum", 2800, "delivered"],
    ["TATA Tiscon TMT bar Fe-500D 12 mm", "kg", 68.5, "net excl GST"], ["Birla White Wall putty 40 kg", "bag", 950, "MRP incl GST"]]);
});

test("an Excel price sheet with its own column names", () => {
  const list = Q.materialsFromRows([["PRICE LIST w.e.f. 01-11-2026"], ["Sr", "Product Description", "Brand", "Size", "UOM", "Dealer Price (Rs)", "MRP"], [1, "PPR pipe PN16", "Supreme", "25 mm", "m", "142.00", 210], [2, "Total", "", "", "", 142, ""]], { supplier: "Supreme dealer", listDate: "2026-11-01" });
  assert.deepEqual(list.map((m) => [m.name, m.make, m.spec, m.unit, m.price, m.supplier]), [["PPR pipe PN16", "Supreme", "25 mm", "m", 142, "Supreme dealer"]]);
});

test("saving prices: new ones get M ids; the same product from the same supplier is updated", () => {
  const first = Q.addMaterials([], Q.materialsFromText(PRICE_REPLY).list, "2026-11-24");
  assert.equal(first.added, 4); assert.deepEqual(first.materials.map((m) => m.id), ["M1", "M2", "M3", "M4"]);
  const newer = Q.materialsFromText(PRICE_REPLY.replace("| 380 |", "| 395 |").replace("2026-10-15", "2026-11-20")).list;
  const second = Q.addMaterials(first.materials, newer, "2026-11-25");
  assert.equal(second.added, 0); assert.equal(second.updated, 4);
  assert.equal(second.materials[0].price, 395); assert.equal(second.materials[0].listDate, "2026-11-20");
});

test("rate requests carry the material prices the items need (not unrelated ones)", () => {
  const { materials } = Q.addMaterials([], Q.materialsFromText(PRICE_REPLY).list, "2026-11-24");
  const [req] = Q.rateRequests([
    { ref: "13.1.1", description: "12 mm cement plaster of mix 1:6 (1 cement : 6 coarse sand)", unit: "sqm", qty: 412, rate: 0 },
    { ref: "5.22A.6", description: "Steel reinforcement, Thermo-Mechanically Treated bars of grade Fe-500D", unit: "kg", qty: 2850, rate: 0 }], { location: "Mysuru", materials });
  assert.match(req.message, /Your material prices \(use the ones each item needs\):/);
  assert.match(req.message, /- M1 UltraTech OPC 43 grade cement 50 kg = 380 per bag \(net excl GST\), Sri Ganesh Traders, Mysuru, 2026-10-15/);
  assert.match(req.message, /M2 Coarse sand/); assert.match(req.message, /M3 TATA Tiscon TMT bar Fe-500D/);
  assert.doesNotMatch(req.message, /putty/);
  assert.deepEqual(Q.basisFromText("| No | Rate | Source | Basis |\n|---|---|---|---|\n| 1 | 248 | built M1+M2 | cement 0.21 bag×380 + sand |", 1), ["cement 0.21 bag×380 + sand"]);
});

test("check flags rates built on old material prices; the AI review sees the makes used", () => {
  const { materials } = Q.addMaterials([], Q.materialsFromText(PRICE_REPLY).list, "2026-11-24");
  const q = { date: "2027-03-01", validUntil: "2027-06-01", company: { name: "A", phone: "1" }, client: { name: "B" },
    items: [{ ref: "5.22A.6", description: "Steel Fe-500D", unit: "kg", qty: 100, rate: 85, materials: ["M3"], rateBasis: "TMT 1.05 kg×68.5 + labour 9" }] };
  const issues = Q.checkQuote(q, { materials, today: new Date("2027-03-01") });
  assert.match(issues.map((i) => i.text).join(" "), /older than 3 months: TATA Tiscon TMT bar Fe-500D 12 mm \(2026-10-15\)/);
  assert.deepEqual(Q.checkQuote(q, { materials, today: new Date("2026-11-30") }), []);
  const m = Q.reviewMessage(q, [], { materials });
  assert.match(m, /\| built up: TMT 1\.05 kg×68\.5 \+ labour 9/);
  assert.match(m, /Material prices used in the rates \(make, size, supplier, date\): M3 TATA Tiscon TMT bar Fe-500D 12 mm = 68\.5 per kg/);
});

// ---------- running bills ----------
function wonQuote() {
  return { id: "q1", currency: "INR", taxLabel: "GST", taxRate: 18, tenderTerms: "- Security deposit 2.5% recovered from each running bill.",
    items: [{ ref: "1", description: "Earthwork", heading: true }, { ref: "1.1", description: "Soil", unit: "cum", qty: 125.5, rate: 290 }, { ref: "2", description: "PCC 1:4:8", unit: "cum", qty: 18.2, rate: 6500 }] };
}
test("RA bills are cumulative: this bill = work to date − earlier bills, then GST and deductions", () => {
  const q = wonQuote();
  q.bills = [{ no: 1, date: "2026-12-31", upto: { 1: 80, 2: 10 } }];
  const one = Q.billAbstract(q, 0);
  assert.equal(one.gross, 88200);                 // 80×290 + 10×6500
  assert.equal(one.tax, 15876); assert.equal(one.billAmount, 104076);
  assert.deepEqual(one.deductions.map((d) => [d.label, d.amount]), [["Security deposit / retention @ 2.5%", 2205], ["Income tax (TDS) @ 2%", 1764], ["GST TDS @ 2%", 1764], ["Labour welfare cess @ 1%", 882]]);
  assert.equal(one.net, 97461);
  q.bills.push(Q.newBill(q, "2027-01-31"));
  assert.deepEqual(q.bills[1], { no: 2, date: "2027-01-31", upto: { 1: 80, 2: 10 } }, "a new bill starts from the last quantities");
  q.bills[1].upto = { 1: 130, 2: 18.2 };
  const two = Q.billAbstract(q, 1);
  assert.equal(two.beforeGross, 88200); assert.equal(two.gross, 67800);   // 50×290 + 8.2×6500
  assert.deepEqual(two.rows.filter((r) => !r.heading).map((r) => [r.ref, r.before, r.thisQty, r.thisAmount]), [["1.1", 80, 50, 14500], ["2", 10, 8.2, 53300]]);
  assert.match(two.flags[0].text, /^1\.1: 130 cum done is more than the tender quantity 125\.5 \(\+4%\)/);
  assert.equal(two.progressPct.toFixed(1), "100.8");
});
test("bill settings: contract overrides, other deduction, Gulf defaults, and a quantity that went down", () => {
  const q = wonQuote(); q.bills = [{ no: 1, upto: { 1: 100 } }, { no: 2, upto: { 1: 90 } }];
  q.billSettings = { itPct: 1, gstTdsPct: 0, cessPct: 0, otherLabel: "Mobilisation advance recovery", otherAmount: 5000 };
  const a = Q.billAbstract(q, 0);
  assert.deepEqual(a.deductions.map((d) => d.label), ["Security deposit / retention @ 2.5%", "Income tax (TDS) @ 1%", "Mobilisation advance recovery"]);
  assert.equal(Q.billAbstract(q, 1).flags[0].level, "red");
  assert.deepEqual(Q.defaultBillSettings({ currency: "AED", taxRate: 5 }), { sdPct: 10, itPct: 0, gstTdsPct: 0, cessPct: 0, otherLabel: "", otherAmount: 0 });
  assert.equal(Q.billAbstract(q, 5), null);
});

// ---------- backup / restore ----------
test("backup: round trip, wrong files refused", () => {
  const data = { quotes: [{ id: "a", updated: 1 }], company: { name: "SV" }, ratebook: [{ id: "R1", description: "PCC", unit: "cum", rate: 6200, currency: "INR" }], materials: [] };
  const b = Q.readBackup(JSON.stringify(Q.makeBackup(data, "2026-11-25T10:00:00Z")));
  assert.deepEqual({ ...b, at: undefined, consultant: undefined }, { ...data, at: undefined, consultant: undefined });
  assert.throws(() => Q.readBackup("{bad"), /not a backup file/);
  assert.throws(() => Q.readBackup({ app: "other" }), /not a Sahi Nirman backup/);
  assert.throws(() => Q.readBackup({ app: "construction-ai-expert", kind: "backup", version: 9 }), /newer version/);
});
test("restore merges: newer quote wins, nothing here is lost, clashing rate ids are renumbered", () => {
  const phone = { quotes: [{ id: "a", number: "Q-1", updated: 200 }, { id: "c", updated: 50 }], company: { name: "SV Smart", phone: "" },
    ratebook: [{ id: "R1", description: "PCC 1:4:8", unit: "cum", rate: 6300, currency: "INR", updated: "2026-11-20" }], materials: [] };
  const backup = { quotes: [{ id: "a", number: "Q-1 old", updated: 100 }, { id: "b", updated: 150 }], company: { name: "Old name", phone: "90000" },
    ratebook: [{ id: "R1", description: "Brick work 1:6", unit: "cum", rate: 7800, currency: "INR", updated: "2026-10-01" }, { id: "R2", description: "PCC 1:4:8", unit: "cum", rate: 6000, currency: "INR", updated: "2026-09-01" }],
    materials: [{ id: "M1", name: "Cement", make: "UltraTech", unit: "bag", price: 380, currency: "INR", supplier: "X", updated: "2026-11-01" }] };
  const m = Q.mergeBackup(phone, backup);
  assert.deepEqual(m.quotes.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(m.quotes[0].number, "Q-1", "the phone's newer copy is kept");
  assert.deepEqual(m.company, { name: "SV Smart", phone: "90000" });
  assert.deepEqual(m.ratebook.map((e) => [e.id, e.description, e.rate]), [["R1", "PCC 1:4:8", 6300], ["R2", "Brick work 1:6", 7800]]);
  assert.deepEqual(m.materials.map((e) => e.id), ["M1"]);
  assert.deepEqual(m.counts, { quotesAdded: 1, quotesUpdated: 0, ratesAdded: 1, pricesAdded: 1, snagsAdded: 0, photosAdded: 0, membersAdded: 0, specRestored: false, specKept: false });
  const again = Q.mergeBackup(m, backup);
  assert.deepEqual([again.quotes.length, again.ratebook.length, again.materials.length], [3, 2, 1], "restoring twice adds nothing");
});

// ---------- my work ----------
test("my work: counts, values, win rate, estimates, deadlines, money from won jobs, rates and backup", () => {
  const item = (rate, qty = 100) => ({ description: "Work", unit: "cum", qty, rate });
  const quotes = [
    { id: "a", number: "Q-1", status: "won", currency: "INR", items: [item(1000)], bid: { estimate: 95000 }, bills: [{ no: 1, upto: { 0: 40 } }, { no: 2, upto: { 0: 70 } }] },
    { id: "b", number: "Q-2", status: "lost", currency: "INR", items: [item(1200)], tenderTerms: "- Estimated cost put to tender: Rs. 1 lakh." },
    { id: "c", number: "Q-3", status: "submitted", currency: "INR", items: [item(500)], validUntil: "2026-12-01" },
    { id: "d", number: "Q-4", currency: "INR", items: [item(10)], dueDate: "2026-11-27", subject: "School compound wall" },
    { id: "e", number: "Q-5", status: "draft", currency: "INR", items: [item(10)], dueDate: "2027-01-30" }
  ];
  const s = Q.workSummary(quotes, { ratebook: [{}, {}], materials: [{ listDate: "2026-06-01" }, { listDate: "2026-11-01" }], lastBackup: Date.parse("2026-11-15"), today: "2026-11-25" });
  assert.deepEqual(s.byStatus, { draft: 2, submitted: 1, won: 1, lost: 1 });
  assert.deepEqual([s.value.won, s.value.lost, s.value.submitted], [100000, 120000, 50000]);
  assert.equal(s.winRate, 50);
  assert.equal(s.wonVsEstimate.toFixed(1), "5.3");     // 1,00,000 vs 95,000
  assert.equal(s.lostVsEstimate.toFixed(1), "20.0");   // 1,20,000 vs 1,00,000 from the key terms
  assert.deepEqual(s.due.map((d) => [d.kind, d.days, d.number]), [["bid-due", 2, "Q-4"], ["validity-ending", 6, "Q-3"]]);
  assert.equal(s.money.contract, 100000);
  assert.equal(s.money.billed, 70000);
  assert.equal(s.money.toBill, 30000);
  assert.equal(s.money.retention, 1750);                // 2.5% of 40,000 + 2.5% of 30,000
  assert.equal(s.money.jobs[0].progressPct, 70);
  assert.ok(s.money.netReceived > 0 && s.money.netReceived < 70000);
  assert.deepEqual(s.rates, { count: 2, prices: 2, oldPrices: 1 });
  assert.equal(s.backupDays, 10);
  assert.equal(Q.workSummary([], {}).winRate, null);
  assert.equal(Q.statusOf({}), "draft");
});

// ---------- filling a client's BOQ format ----------
test("client's format: matched by item number, then by description with the same numbers; nothing guessed", () => {
  const rows = [["Name of work: Anganwadi"], [], ["Sl. No.", "Item Description", "Quantity", "Units", "BASIC RATE In Figures To be entered by the Bidder in Rs. P", "TOTAL AMOUNT With Taxes"], [1, 2, 3, 4, 5, 6],
    ["1", "Earth work in excavation by mechanical means, lead 50 m and lift 1.5 m", "", "", "", ""], ["1.1", "All kinds of soil", 125.5, "cum", "", ""], ["1.2", "Ordinary rock", 12, "cum", "", ""],
    ["2", "Providing and laying cement concrete 1:4:8 up to plinth level, excluding centering and shuttering", 18.2, "cum", "", ""], ["3", "Steel reinforcement Fe-500D", 500, "kg", "", ""],
    ["4", "Plaster 12 mm 1:6", 100, "sqm", "", ""], ["", "Total in Figures", "", "", "", ""]];
  const items = [{ ref: "1.1", description: "All kinds of soil", unit: "cum", qty: 125.5, rate: 290 }, { ref: "", description: "Ordinary rock (any)", unit: "cum", qty: 12, rate: 1500 },
    { ref: "2", description: "Providing and laying cement concrete 1:4:8 up to plinth level, excluding centering and shuttering", unit: "cum", qty: 20, rate: 6500 },
    { ref: "9", description: "Plaster 12 mm 1:4", unit: "sqm", qty: 100, rate: 330 }];
  const r = Q.formatFill(rows, items);
  assert.deepEqual([r.headerRow, r.col.rate, r.col.amount, r.col.qty], [2, 4, 5, 2]);
  assert.deepEqual(r.assignments.map((a) => [a.row, a.ref, a.rate, a.amount, a.how, a.qtyDiffers]), [
    [5, "1.1", 290, 36395, "item number", false], [6, "1.2", 1500, 18000, "description", false], [7, "2", 6500, 118300, "item number", true]]);
  assert.deepEqual(r.unmatchedRows.map((u) => u.ref), ["3", "4"], "1:6 plaster is never filled with the 1:4 rate");
  assert.deepEqual(r.unusedItems, [3]);
  assert.equal(r.total, 172695);
  assert.match(Q.formatFill([["Item", "Description", "Qty", "Unit"], ["1", "x", 1, "m"]], items).error, /no Rate column/);
  assert.match(Q.formatFill([["a"], ["b"]], items).error, /No BOQ table/);
});

// ---------- progress bar ----------
test("progress estimate rises, slows, never passes 95% by itself; steps follow the %", () => {
  const P = require("../assets/progress.js");
  const at = (s) => Math.round(P.estimate(s * 1000, 60000));
  assert.deepEqual([at(0), at(15), at(30), at(60), at(120), at(600)], [0, 31, 52, 76, 91, 95]);
  const steps = [[0, "Reading"], [20, "Quantities"], [50, "Writing"], [80, "Checking"]];
  assert.deepEqual([5, 20, 60, 95].map((p) => P.stepFor(p, steps)), ["Reading", "Quantities", "Writing", "Checking"]);
});

test("backup carries the consultant work; restore adds new snags and members and never overwrites a draft", () => {
  const work = { snags: { project: "School", by: "VK", photos: [{ id: "p1", thumb: "AAA" }], snags: [{ id: "s1", photo: "p1", defect: "Honeycombing", severity: "Major", status: "Open" }] },
    bbs: [{ mark: "B1", type: "beam", L: "4000", main: "3-16" }, { mark: "C1", type: "column" }], spec: "<h3>1. Earthwork</h3>" };
  const b = Q.readBackup(JSON.stringify(Q.makeBackup({ quotes: [], consultant: work })));
  assert.deepEqual(b.consultant, work);
  assert.deepEqual(Q.consultantCount(b.consultant), { snags: 1, photos: 1, members: 2, spec: 1 });
  // an old backup without consultant work still reads
  assert.deepEqual(Q.readBackup({ app: "construction-ai-expert", kind: "backup", version: 1 }).consultant, { snags: { project: "", by: "", photos: [], snags: [] }, bbs: [], spec: "" });

  // a fresh phone (only the example beam, empty draft) gets everything
  const fresh = Q.mergeBackup({ quotes: [], consultant: { snags: null, bbs: [{ mark: "B1", type: "beam", count: "4", L: "4000", B: "230", D: "450", main: "3-16", top: "2-12", st: "8@150" }], spec: "" } }, b);
  assert.equal(fresh.consultant.snags.snags.length, 1);
  assert.equal(fresh.consultant.snags.project, "School");
  assert.deepEqual(fresh.consultant.bbs.map((m) => m.mark), ["B1", "C1"], "the example beam is replaced, not doubled");
  assert.equal(fresh.consultant.spec, work.spec);
  assert.deepEqual([fresh.counts.snagsAdded, fresh.counts.photosAdded, fresh.counts.membersAdded, fresh.counts.specRestored], [1, 1, 2, true]);

  // a phone with its own work keeps it: same snag not doubled, own members kept, own draft kept
  const mine = { snags: { project: "Mall", by: "", photos: [{ id: "p9" }], snags: [{ id: "s9", photo: "p9", defect: "Crack" }, { id: "s1", photo: "p1", defect: "Honeycombing" }] }, bbs: [{ mark: "F1", type: "footing" }], spec: "<p>My edited draft</p>" };
  const m = Q.mergeBackup({ quotes: [], consultant: mine }, b);
  assert.deepEqual(m.consultant.snags.snags.map((x) => x.id), ["s9", "s1"]);
  assert.equal(m.consultant.snags.project, "Mall");
  assert.deepEqual(m.consultant.bbs.map((x) => x.mark), ["F1", "B1", "C1"]);
  assert.equal(m.consultant.spec, "<p>My edited draft</p>");
  assert.equal(m.counts.specKept, true);
  assert.equal(Q.mergeBackup(m, b).counts.snagsAdded, 0, "restoring twice adds nothing");
});

test("the backup is an Excel file: readable sheets, a hidden complete copy, and it restores exactly", () => {
  const XLSX = require("xlsx");
  const data = Q.makeBackup({
    quotes: [{ id: "q1", number: "Q-7", date: "2026-11-25", currency: "INR", status: "won", client: { name: "KRIDL" }, subject: "Anganwadi", taxRate: 18,
      items: [{ ref: "A", description: "Earthwork", heading: true }, { ref: "1", description: "PCC 1:4:8", unit: "cum", qty: 2, rate: 6000 }] }],
    ratebook: [{ id: "R1", description: "PCC 1:4:8", unit: "cum", rate: 6000, currency: "INR", updated: "2026-11-20" }],
    materials: [{ id: "M1", name: "Cement", make: "UltraTech", unit: "bag", price: 380, currency: "INR", supplier: "X" }],
    consultant: { snags: { project: "School", by: "VK", photos: [{ id: "p1", thumb: "A".repeat(70000) }], snags: [{ id: "s1", photo: "p1", location: "C3", defect: "Honeycombing", severity: "Major", remedy: "Patch", status: "Open" }] },
      bbs: [{ mark: "B1", type: "beam", main: "3-16" }], spec: "<h3>1. Earthwork</h3><p>Excavate &amp; dispose</p>" }
  }, "2026-11-25T10:00:00Z");
  const buf = XLSX.write(Q.backupWorkbook(XLSX, data), { bookType: "xlsx", type: "buffer" });
  const wb = XLSX.read(buf, { type: "buffer" });
  assert.deepEqual(wb.SheetNames, ["Read me", "Quotations", "Quotation items", "My rates", "Material prices", "Site snags", "BBS members", "Spec draft", "_data"]);
  assert.equal(wb.Workbook.Sheets.find((s) => s.name === "_data").Hidden, 2, "the data sheet is very hidden");
  const rows = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "" });
  assert.deepEqual(rows("Quotations")[1].slice(0, 7), ["Q-7", "2026-11-25", "KRIDL", "Anganwadi", "won", 1, 14160]);
  assert.deepEqual(rows("Quotation items")[2], ["Q-7", "1", "PCC 1:4:8", "cum", 2, 6000, 12000]);
  assert.deepEqual(rows("Site snags")[2].slice(0, 7), [1, "P1", "C3", "Honeycombing", "Major", "", "Patch"]);
  assert.deepEqual(rows("Spec draft"), [["1. Earthwork"], ["Excavate & dispose"]]);
  assert.ok(rows("_data").length >= 3, "a long backup is split over several cells");
  // restore reads the complete copy, photos included
  assert.deepEqual(Q.backupFromWorkbook(XLSX, wb), Q.readBackup(JSON.stringify(data)));
  // an ordinary spreadsheet is refused
  const plain = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(plain, XLSX.utils.aoa_to_sheet([["a"]]), "Sheet1");
  assert.throws(() => Q.backupFromWorkbook(XLSX, plain), /not a Sahi Nirman backup/);
});
