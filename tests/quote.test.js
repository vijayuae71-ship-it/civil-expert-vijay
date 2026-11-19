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
