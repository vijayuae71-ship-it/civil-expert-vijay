/* Quotation helpers: pure functions shared by quotation.html, expert.html and the tests.
 * - itemsFromAnswer(text): turns the BOQ table in an AI answer into quotation lines
 * - totals(quote): subtotal, discount, tax and grand total
 * - shareText(quote): a WhatsApp-friendly plain-text quotation */
(function (root) {
  "use strict";

  const CURRENCIES = {
    INR: { symbol: "₹", pdf: "Rs.", locale: "en-IN", tax: "GST", rate: 18 },
    AED: { symbol: "AED", pdf: "AED", locale: "en-AE", tax: "VAT", rate: 5 },
    SAR: { symbol: "SAR", pdf: "SAR", locale: "en-US", tax: "VAT", rate: 15 },
    QAR: { symbol: "QAR", pdf: "QAR", locale: "en-US", tax: "VAT", rate: 0 },
    OMR: { symbol: "OMR", pdf: "OMR", locale: "en-US", tax: "VAT", rate: 5 },
    KWD: { symbol: "KWD", pdf: "KWD", locale: "en-US", tax: "VAT", rate: 0 },
    BHD: { symbol: "BHD", pdf: "BHD", locale: "en-US", tax: "VAT", rate: 10 },
    USD: { symbol: "$", pdf: "USD", locale: "en-US", tax: "Tax", rate: 0 }
  };

  const round2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;

  // "₹ 1,23,456.50", "AED 4,500", "4500/-", "12.5 m³" → number (NaN when there is none)
  function toNumber(value) {
    const s = String(value == null ? "" : value).replace(/\*\*/g, "");
    const m = s.replace(/(\d),(?=\d)/g, "$1").match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }

  function money(n, currency = "INR", { pdf = false } = {}) {
    const c = CURRENCIES[currency] || CURRENCIES.INR;
    const digits = ["OMR", "KWD", "BHD"].includes(currency) ? 3 : 2;
    const v = (Number(n) || 0).toLocaleString(c.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return `${pdf ? c.pdf : c.symbol} ${v}`;
  }

  function detectCurrency(text) {
    const s = String(text || "");
    const count = (re) => (s.match(re) || []).length;
    const scores = {
      INR: count(/₹|\bINR\b|\bRs\.?(?=\s|\d)/g),
      AED: count(/\bAED\b|dirham/gi),
      SAR: count(/\bSAR\b|riyal/gi),
      QAR: count(/\bQAR\b/g), OMR: count(/\bOMR\b/g), KWD: count(/\bKWD\b/g), BHD: count(/\bBHD\b/g),
      USD: count(/\bUSD\b|US\$/g)
    };
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
    return best[1] > 0 ? best[0] : "";
  }

  // ---------- reading the BOQ table in an answer ----------
  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  const isDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const splitRow = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));
  const isTotalRow = (cells) => cells.some((c) => /^\s*(sub-?\s*total|grand\s*total|total|net\s*total|gst|vat|tax|discount|contingenc|round(ed|ing)?\s*off|overheads?\s*(&|and)\s*profit\s*total)\b/i.test(c));

  function tables(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n"), out = [];
    for (let i = 0; i < lines.length;) {
      if (!isTableRow(lines[i])) { i++; continue; }
      const rows = [];
      while (i < lines.length && (isTableRow(lines[i]) || isDivider(lines[i]))) { if (!isDivider(lines[i])) rows.push(splitRow(lines[i])); i++; }
      if (rows.length > 1) out.push(rows);
    }
    return out;
  }

  const isSerial = (h) => /^\s*(sl|s\.?\s*no|sr|#|item\s*(no|#|code)|no\.?)\b/i.test(h) || /^\s*(no|#)\.?\s*$/i.test(h);
  function columns(header) {
    const serial = header.map((h, i) => (isSerial(h) ? i : -1)).filter((i) => i !== -1);
    const find = (re, skip = []) => header.findIndex((h, i) => !serial.includes(i) && !skip.includes(i) && re.test(h));
    const amount = find(/amount|total|cost|value/i);
    const rate = find(/rate|unit\s*price|price/i, [amount]);
    const qty = find(/qty|quantity|quantities|\bnos?\.?\s*$|no\.? of/i, [amount, rate]);
    const unit = find(/^\s*(unit|uom|units?)\s*$/i, [amount, rate, qty]);
    const taken = [amount, rate, qty, unit];
    let desc = find(/description|particular/i, taken);
    if (desc === -1) desc = find(/item|work|activity|material|component|scope|head/i, taken);
    if (desc === -1) desc = header.findIndex((_, i) => !serial.includes(i) && !taken.includes(i));
    return { desc, unit, qty, rate, amount };
  }

  // The answer's best priceable table → [{ description, unit, qty, rate }]
  function itemsFromAnswer(text) {
    let best = null;
    for (const rows of tables(text)) {
      const col = columns(rows[0]);
      if (col.desc === -1 || (col.rate === -1 && col.amount === -1)) continue;
      const score = (col.rate !== -1) + (col.amount !== -1) + (col.qty !== -1) + rows.length / 100;
      if (!best || score > best.score) best = { rows, col, score };
    }
    if (!best) return [];
    const { rows, col } = best, items = [];
    for (const r of rows.slice(1)) {
      if (isTotalRow(r)) continue;
      const description = (r[col.desc] || "").trim();
      if (!description) continue;
      let qty = col.qty !== -1 ? toNumber(r[col.qty]) : NaN;
      let rate = col.rate !== -1 ? toNumber(r[col.rate]) : NaN;
      const amount = col.amount !== -1 ? toNumber(r[col.amount]) : NaN;
      if (!Number.isFinite(qty)) qty = Number.isFinite(rate) && Number.isFinite(amount) && rate ? round2(amount / rate) : 1;
      if (!Number.isFinite(rate)) rate = Number.isFinite(amount) && qty ? round2(amount / qty) : 0;
      if (!Number.isFinite(rate) && !Number.isFinite(amount)) continue;
      items.push({ description, unit: col.unit !== -1 ? (r[col.unit] || "").trim() : "", qty, rate });
    }
    return items;
  }

  // ---------- quotation maths ----------
  function totals(q) {
    const items = (q.items || []).map((it) => ({ ...it, amount: round2((Number(it.qty) || 0) * (Number(it.rate) || 0)) }));
    const subtotal = round2(items.reduce((s, it) => s + it.amount, 0));
    const discount = round2(Math.min(subtotal, Math.max(0, Number(q.discount) || 0)));
    const taxable = round2(subtotal - discount);
    const tax = round2(taxable * Math.max(0, Number(q.taxRate) || 0) / 100);
    return { items, subtotal, discount, taxable, tax, total: round2(taxable + tax) };
  }

  function quoteNumber(date = new Date(), seq = 1) {
    const d = date.toISOString().slice(0, 10).replace(/-/g, "");
    return `Q-${d}-${String(seq).padStart(2, "0")}`;
  }

  function shareText(q) {
    const t = totals(q), cur = q.currency || "INR", m = (n) => money(n, cur);
    const L = [];
    L.push(`*QUOTATION ${q.number || ""}*`.replace(/\s+\*$/, "*"));
    if (q.company && q.company.name) L.push(q.company.name);
    L.push(`Date: ${q.date || ""}${q.validUntil ? ` · Valid until: ${q.validUntil}` : ""}`);
    if (q.client && q.client.name) L.push(`To: ${q.client.name}${q.client.site ? ` — ${q.client.site}` : ""}`);
    if (q.subject) L.push(`Subject: ${q.subject}`);
    L.push("");
    t.items.forEach((it, i) => L.push(`${i + 1}. ${it.description}\n   ${it.qty} ${it.unit || ""} × ${m(it.rate)} = *${m(it.amount)}*`.replace(/ {2,}×/, " ×")));
    L.push("");
    L.push(`Subtotal: ${m(t.subtotal)}`);
    if (t.discount) L.push(`Discount: −${m(t.discount)}`);
    if (Number(q.taxRate)) L.push(`${q.taxLabel || CURRENCIES[cur]?.tax || "Tax"} ${q.taxRate}%: ${m(t.tax)}`);
    L.push(`*TOTAL: ${m(t.total)}*`);
    L.push(`(${amountInWords(t.total, cur)})`);
    if (q.terms) { L.push(""); L.push("Terms:"); L.push(String(q.terms).trim()); }
    const c = q.company || {};
    const contact = [c.phone, c.email].filter(Boolean).join(" · ");
    if (contact) { L.push(""); L.push(contact); }
    return L.join("\n");
  }

  // ---------- amount in words ----------
  const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const under100 = (n) => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
  const under1000 = (n) => [n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" : "", under100(n % 100)].filter(Boolean).join(" ");
  function words(n, indian) {
    n = Math.floor(n);
    if (!n) return "Zero";
    const steps = indian ? [[1e7, "Crore"], [1e5, "Lakh"], [1e3, "Thousand"]] : [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]];
    const out = [];
    for (const [size, name] of steps) if (n >= size) { out.push(`${indian && size === 1e7 ? words(Math.floor(n / size), true) : under1000(Math.floor(n / size))} ${name}`); n %= size; }
    if (n) out.push(under1000(n));
    return out.join(" ");
  }
  const MONEY_NAMES = { INR: ["Rupees", "Paise", 100], AED: ["UAE Dirhams", "Fils", 100], SAR: ["Saudi Riyals", "Halalas", 100], QAR: ["Qatari Riyals", "Dirhams", 100], OMR: ["Omani Rials", "Baisa", 1000], KWD: ["Kuwaiti Dinars", "Fils", 1000], BHD: ["Bahraini Dinars", "Fils", 1000], USD: ["US Dollars", "Cents", 100] };
  function amountInWords(amount, currency = "INR") {
    const [major, minor, per] = MONEY_NAMES[currency] || MONEY_NAMES.INR;
    const total = Math.round(Math.max(0, Number(amount) || 0) * per);
    const whole = Math.floor(total / per), frac = total % per;
    return `${major} ${words(whole, currency === "INR")}${frac ? ` and ${words(frac, false)} ${minor}` : ""} Only`;
  }

  const api = { CURRENCIES, toNumber, money, detectCurrency, itemsFromAnswer, totals, quoteNumber, shareText, amountInWords, isTotalRow };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QUOTE = api;
})(typeof self !== "undefined" ? self : this);
