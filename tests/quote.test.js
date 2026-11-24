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
