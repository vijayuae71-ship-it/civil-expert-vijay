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
      if (!Number.isFinite(rate) && !Number.isFinite(amount)) continue;   // section heading rows
      if (!Number.isFinite(qty)) qty = Number.isFinite(rate) && Number.isFinite(amount) && rate ? round2(amount / rate) : 1;
      if (!Number.isFinite(rate)) rate = Number.isFinite(amount) && qty ? round2(amount / qty) : 0;
      if (!Number.isFinite(rate) && !Number.isFinite(amount)) continue;
      items.push({ description, unit: col.unit !== -1 ? (r[col.unit] || "").trim() : "", qty, rate });
    }
    return items;
  }

  // ---------- tender BOQs (Excel/CSV rows, or a table the AI copied from a PDF) ----------
  // Keeps the tender's own item numbers, descriptions, units and quantities. Rows without a
  // quantity (parent items such as "Providing and laying … in:") stay as headings.
  const cellStr = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  function findHeader(rows, maxScan = 40) {
    for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
      const header = (rows[i] || []).map(cellStr);
      if (header.filter(Boolean).length < 3) continue;
      const col = columns(header);
      if (col.desc !== -1 && col.qty !== -1 && /[a-z]/i.test(header[col.desc] || "") && /[a-z]/i.test(header[col.qty] || "")) {
        return { index: i, col: { ...col, ref: header.findIndex(isSerial) } };
      }
    }
    return null;
  }
  function tenderItems(rows) {
    const found = findHeader(rows || []);
    if (!found) return [];
    const { col } = found, items = [];
    for (const raw of rows.slice(found.index + 1)) {
      const r = (raw || []).map(cellStr);
      const description = r[col.desc] || "", ref = col.ref !== -1 ? r[col.ref] || "" : "";
      if (!description || /^\d+$/.test(description)) continue;        // empty rows, and the "1 2 3 4" column-number row
      if (isTotalRow([description, ref])) continue;
      const qty = toNumber(r[col.qty]);
      const rate = col.rate !== -1 ? toNumber(r[col.rate]) : NaN;
      const unit = col.unit !== -1 ? r[col.unit] || "" : "";
      if (!Number.isFinite(qty) || (qty === 0 && !unit)) items.push({ ref, description, heading: true });
      else items.push({ ref, description, unit, qty, rate: Number.isFinite(rate) ? rate : 0 });
    }
    // Drop trailing headings with nothing under them (notes, signatures).
    while (items.length && items[items.length - 1].heading) items.pop();
    return items;
  }
  const tenderItemsFromText = (text) => tables(text).flatMap((rows) => tenderItems(rows));

  // Numbered item lists for the AI (rates, plain-language summaries): at most `size` items each.
  // `want` picks the items (default: every non-heading item); indexes refer to `items`.
  function itemRequests(items, header, want = () => true, size = 40) {
    const priced = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.heading && want(it));
    const out = [];
    for (let k = 0; k < priced.length; k += size) {
      const chunk = priced.slice(k, k + size);
      const lines = chunk.map(({ it, i }, n) => {
        let parent = "";
        for (let j = i - 1; j >= 0; j--) if (items[j].heading) { parent = items[j].description; break; }
        const desc = `${parent && String(it.description).length < 80 ? parent.slice(0, 300) + " — " : ""}${it.description}`.slice(0, 600);
        return `${n + 1}. ${it.ref ? `[${it.ref}] ` : ""}${desc} (unit: ${it.unit || "-"}, qty: ${it.qty})`;
      });
      out.push({ indexes: chunk.map(({ i }) => i), message: `${header}\nItems:\n${lines.join("\n")}` });
    }
    return out;
  }
  const rateRequests = (items, { location = "", currency = "INR", month = "", want } = {}, size = 40) =>
    itemRequests(items, `Site location: ${location || "not stated"}. Currency: ${currency}. Month: ${month}.`, want, size);
  const simplifyRequests = (items, { want } = {}, size = 40) => itemRequests(items, "Explain each tender item in short, simple words.", want, size);

  // The AI's numbered table ("No | Rate | …" or "No | In short") → values in item order.
  function columnFromText(text, count, parse) {
    const out = Array(count).fill(undefined);
    for (const rows of tables(text)) for (const r of rows.slice(1)) {
      const n = parseInt(r[0], 10), v = parse(r[1]);
      if (n >= 1 && n <= count && v !== undefined) out[n - 1] = v;
    }
    return out;
  }
  const ratesFromText = (text, count) => columnFromText(text, count, (c) => { const v = toNumber(c); return Number.isFinite(v) && v >= 0 ? v : undefined; }).map((v) => (v === undefined ? NaN : v));
  const shortsFromText = (text, count) => columnFromText(text, count, (c) => (String(c || "").trim() ? String(c).trim() : undefined));

  // ---------- checks before submitting (no AI) ----------
  // Items imported from a tender keep `orig` (the tender's qty, unit, description); q.tenderRefs lists
  // the tender's item numbers. Returns [{ level: "red" | "amber", text }], most serious first.
  function checkQuote(q) {
    const issues = [], items = q.items || [], priced = items.filter((it) => !it.heading && String(it.description || "").trim());
    const name = (it) => it.ref || `"${String(it.description).slice(0, 30)}"`;
    const list = (arr, max = 6) => arr.slice(0, max).join(", ") + (arr.length > max ? ` and ${arr.length - max} more` : "");
    const noRate = priced.filter((it) => !(Number(it.rate) > 0));
    if (noRate.length) issues.push({ level: "red", text: `${noRate.length} item${noRate.length === 1 ? " has" : "s have"} no rate: ${list(noRate.map(name))}. Fill every rate before submitting.` });
    const noQty = priced.filter((it) => !(Number(it.qty) > 0));
    if (noQty.length) issues.push({ level: "red", text: `Quantity is zero or empty for ${list(noQty.map(name))}.` });
    const qtyChanged = priced.filter((it) => it.orig && Number(it.orig.qty) !== Number(it.qty));
    if (qtyChanged.length) issues.push({ level: "red", text: `Quantity changed from the tender for ${list(qtyChanged.map((it) => `${name(it)} (${it.orig.qty} → ${it.qty})`), 4)}. Tender quantities must normally be kept as given.` });
    if (Array.isArray(q.tenderRefs) && q.tenderRefs.length) {
      const have = new Set(items.map((it) => it.ref));
      const missing = q.tenderRefs.filter((r) => r && !have.has(r));
      if (missing.length) issues.push({ level: "red", text: `Tender item${missing.length === 1 ? "" : "s"} missing from your quote: ${list(missing)}. Every tender item must be quoted.` });
    }
    const unitChanged = priced.filter((it) => it.orig && String(it.orig.unit || "") !== String(it.unit || ""));
    if (unitChanged.length) issues.push({ level: "amber", text: `Unit changed from the tender for ${list(unitChanged.map((it) => `${name(it)} (${it.orig.unit} → ${it.unit})`), 4)}.` });
    const descChanged = items.filter((it) => it.orig && String(it.orig.description) !== String(it.description));
    if (descChanged.length) issues.push({ level: "amber", text: `Description edited for ${list(descChanged.map(name))}. Keep the tender wording exactly unless the tender allows changes.` });
    if (q.fromTender) {
      const added = priced.filter((it) => !it.orig);
      if (added.length) issues.push({ level: "amber", text: `${added.length} item${added.length === 1 ? " is" : "s are"} not in the tender: ${list(added.map(name))}. Extra items are usually not allowed in a tender quote.` });
    }
    const ai = priced.filter((it) => it.aiRate);
    if (ai.length) issues.push({ level: "amber", text: `${ai.length} rate${ai.length === 1 ? " is" : "s are"} still the AI suggestion (${list(ai.map(name))}). Check each against your own costs and supplier prices.` });
    const seen = new Map(); items.forEach((it) => { if (it.ref) seen.set(it.ref, (seen.get(it.ref) || 0) + 1); });
    const dup = [...seen].filter(([, n]) => n > 1).map(([r]) => r);
    if (dup.length) issues.push({ level: "amber", text: `Item number used twice: ${list(dup)}.` });
    const c = q.company || {};
    const missingCo = [!c.name && "company name", !c.phone && !c.email && "phone or email"].filter(Boolean);
    if (missingCo.length) issues.push({ level: "amber", text: `Your ${missingCo.join(" and ")} ${missingCo.length === 1 ? "is" : "are"} missing on the quotation.` });
    if (!(q.client && q.client.name)) issues.push({ level: "amber", text: "The client / department name is empty." });
    if (q.validUntil && q.date && (Date.parse(q.validUntil) - Date.parse(q.date)) / 864e5 < 30) issues.push({ level: "amber", text: "The quote is valid for less than 30 days. Tenders often ask for 90 days or more — check the tender." });
    return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
  }

  // A compact text of the quotation for the AI review.
  function reviewMessage(q, autoIssues = []) {
    const t = totals(q), cur = q.currency || "INR";
    const days = q.validUntil && q.date ? Math.round((Date.parse(q.validUntil) - Date.parse(q.date)) / 864e5) : "";
    const lines = t.items.filter((it) => !it.heading).slice(0, 400).map((it) => `${it.ref || "-"} | ${(it.short || String(it.description)).replace(/\s+/g, " ").slice(0, 160)} | ${it.unit || ""} | ${it.qty} | ${it.rate} | ${it.amount}${it.aiRate ? " | AI rate" : ""}`);
    return [
      `Tender key terms (plain summary):\n${q.tenderTerms ? String(q.tenderTerms).slice(0, 6000) : "Not available."}`,
      `Quotation: currency ${cur}; ${Number(q.taxRate) ? `${q.taxLabel || "tax"} ${q.taxRate}% added on top` : "no tax added"}; discount ${t.discount}; quote valid ${days} days; total ${t.total}.`,
      `Quotation terms:\n${String(q.terms || "").slice(0, 2000)}`,
      `Site / project: ${(q.client && q.client.site) || "not stated"}. Subject: ${q.subject || ""}`,
      `Items (Item No | description | unit | qty | rate | amount):\n${lines.join("\n")}`,
      `Already found by the automatic check (do not repeat): ${autoIssues.map((i) => i.text).join(" / ") || "nothing"}`
    ].join("\n\n");
  }

  // ---------- quotation maths ----------
  function totals(q) {
    const items = (q.items || []).map((it) => ({ ...it, amount: it.heading ? 0 : round2((Number(it.qty) || 0) * (Number(it.rate) || 0)) }));
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
    let n = 0;
    t.items.forEach((it) => {
      if (it.heading) { L.push(`*${it.ref ? it.ref + " " : ""}${it.description}*`); return; }
      n += 1;
      L.push(`${it.ref || n}. ${it.description}\n   ${it.qty} ${it.unit || ""} × ${m(it.rate)} = *${m(it.amount)}*`.replace(/ {2,}×/, " ×"));
    });
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

  const api = { CURRENCIES, toNumber, money, detectCurrency, itemsFromAnswer, tenderItems, tenderItemsFromText, ratesFromText, shortsFromText, rateRequests, simplifyRequests, checkQuote, reviewMessage, totals, quoteNumber, shareText, amountInWords, isTotalRow };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QUOTE = api;
})(typeof self !== "undefined" ? self : this);
