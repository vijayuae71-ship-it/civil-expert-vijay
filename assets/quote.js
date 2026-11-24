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
  // A sub-item such as "All kinds of soil" means little alone: put its parent heading in front.
  function fullDescription(items, i) {
    const it = items[i];
    // Only a real parent: "1.1" under "1", "5.33.1" under "5.33" (not any heading above a user-added item).
    let parent = "";
    const ref = String(it.ref || "");
    for (let j = i - 1; j >= 0; j--) {
      const h = items[j];
      if (!h.heading) continue;
      const hr = String(h.ref || "");
      if (ref && hr && (ref.startsWith(hr + ".") || ref.startsWith(hr + "("))) parent = h.description;
      break;
    }
    return `${parent && String(it.description).length < 80 ? String(parent).slice(0, 300) + " — " : ""}${it.description}`.slice(0, 600);
  }
  // `extra(i)` may add a line under an item (e.g. the contractor's own rates for similar work).
  function itemRequests(items, header, want = () => true, size = 40, extra = () => "") {
    const priced = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.heading && want(it));
    const out = [];
    for (let k = 0; k < priced.length; k += size) {
      const chunk = priced.slice(k, k + size);
      const lines = chunk.map(({ it, i }, n) => {
        const more = extra(i);
        return `${n + 1}. ${it.ref ? `[${it.ref}] ` : ""}${fullDescription(items, i)} (unit: ${it.unit || "-"}, qty: ${it.qty})${more ? `\n   ${more}` : ""}`;
      });
      const indexes = chunk.map(({ i }) => i);
      out.push({ indexes, message: `${typeof header === "function" ? header(indexes) : header}\nItems:\n${lines.join("\n")}` });
    }
    return out;
  }
  // With a rate book, each item lists the contractor's own rates for similar work (ids R1, R2 …).
  const rateRequests = (items, { location = "", currency = "INR", month = "", want, book = [], materials = [] } = {}, size = 40) =>
    itemRequests(items, (indexes) => {
      const mats = relevantMaterials(indexes.map((i) => fullDescription(items, i)), materials, { currency });
      return `Site location: ${location || "not stated"}. Currency: ${currency}. Month: ${month}.${mats.length ? `\nYour material prices (use the ones each item needs):\n${mats.map((m) => `- ${materialLine(m)}`).join("\n")}` : ""}`;
    }, want, size, (i) => {
      const own = similarRates({ ...items[i], description: fullDescription(items, i) }, book, { currency });
      return own.length ? `Your rates for similar work: ${own.map(({ entry }) => `${entry.id} = ${entry.rate} per ${entry.unit || "unit"} (${String(entry.short || entry.description).slice(0, 140)})`).join("; ")}` : "";
    });

  // ---------- my rate book ----------
  // Rates the contractor has actually quoted, kept on the device and reused for new tenders.
  const STOP = new Set("the of and in for with to by at on a an all as per including incl excluding complete etc work works providing laying fixing position specified".split(" "));
  const tokens = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9.:/ ]+/g, " ").split(/\s+/).map((w) => w.replace(/^[.:/]+|[.:/]+$/g, "")).filter((w) => w && !STOP.has(w));
  function similarity(a, b) {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let n = 0; for (const w of A) if (B.has(w)) n++;
    return (2 * n) / (A.size + B.size);
  }
  const UNIT_ALIASES = [[/^(cum|m3|m³|cubicmetres?|cubicmeters?|cumtr|cmt)$/, "m3"], [/^(sqm|m2|m²|sqmt|sqmtr|squaremetres?|squaremeters?)$/, "m2"], [/^(rm|rmt|m|metres?|meters?|mtrs?|lm|rmtr)$/, "m"],
    [/^(nos?|each|numbers?|nr|pcs|pieces?|units?)$/, "no"], [/^(kgs?|kilograms?)$/, "kg"], [/^(mt|tonnes?|tons?|t|mts)$/, "t"], [/^(sqft|sft|sqfeet)$/, "sqft"], [/^(cft|cuft)$/, "cft"], [/^(ls|lumpsum|lot|job)$/, "ls"]];
  function normUnit(u) {
    const s = String(u || "").toLowerCase().replace(/[^a-z0-9³²]/g, "");
    for (const [re, v] of UNIT_ALIASES) if (re.test(s)) return v;
    return s;
  }
  function similarRates(item, book, { currency = "INR", limit = 4, min = 0.35 } = {}) {
    const unit = normUnit(item.unit);
    return (book || [])
      .filter((e) => (e.currency || "INR") === currency && Number(e.rate) > 0 && (!unit || !e.unit || normUnit(e.unit) === unit))
      .map((entry) => ({ entry, score: similarity(item.description, entry.description) }))
      .filter((x) => x.score >= min)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  // The same work (nearly the same words, same unit): use it without asking the AI.
  function ownRateFor(item, book, opts = {}) {
    const [best] = similarRates(item, book, { ...opts, limit: 1, min: 0.9 });
    return best && normUnit(best.entry.unit) === normUnit(item.unit) ? best.entry : null;
  }
  const bookKey = (description, unit, currency) => `${tokens(description).join(" ")}|${normUnit(unit)}|${currency || "INR"}`;
  // Adds the quote's checked rates (not AI suggestions) to the book; an existing entry gets the new rate and keeps a short history.
  function addToRateBook(book, q, date = new Date().toISOString().slice(0, 10)) {
    const out = (book || []).map((e) => ({ ...e }));
    const byKey = new Map(out.map((e) => [bookKey(e.description, e.unit, e.currency), e]));
    let next = out.reduce((m, e) => Math.max(m, parseInt(String(e.id).slice(1), 10) || 0), 0);
    let added = 0, updated = 0;
    (q.items || []).forEach((it, i) => {
      if (it.heading || it.aiRate || !(Number(it.rate) > 0) || !String(it.description || "").trim()) return;
      const description = fullDescription(q.items, i), key = bookKey(description, it.unit, q.currency);
      const found = byKey.get(key);
      if (found) {
        if (Number(found.rate) !== Number(it.rate)) { found.history = [{ rate: found.rate, date: found.updated, from: found.from }, ...(found.history || [])].slice(0, 5); found.rate = Number(it.rate); updated++; }
        found.updated = date; found.from = q.number || ""; if (it.short) found.short = it.short;
      } else {
        const e = { id: `R${++next}`, description, short: it.short || "", unit: it.unit || "", rate: Number(it.rate), currency: q.currency || "INR", updated: date, from: q.number || "", history: [] };
        out.push(e); byKey.set(key, e); added++;
      }
    });
    return { book: out, added, updated };
  }
  // A rate list from Excel/CSV: description, unit and rate columns (no quantity needed).
  function rateListFromRows(rows, currency = "INR", date = new Date().toISOString().slice(0, 10)) {
    for (let h = 0; h < Math.min((rows || []).length, 40); h++) {
      const header = (rows[h] || []).map(cellStr);
      const col = columns(header);
      if (col.desc === -1 || col.rate === -1 || !/[a-z]/i.test(header[col.rate] || "")) continue;
      const out = [];
      for (const raw of rows.slice(h + 1)) {
        const r = (raw || []).map(cellStr), rate = toNumber(r[col.rate]);
        if (!r[col.desc] || !(rate > 0)) continue;
        out.push({ description: r[col.desc], unit: col.unit !== -1 ? r[col.unit] : "", rate, currency, updated: date, from: "imported", history: [] });
      }
      return out;
    }
    return [];
  }
  // The AI's "Source" column: "R12" (own rate used as is), "R12 adjusted", or "market".
  const basisFromText = (text, count) => {
    const out = Array(count).fill(undefined);
    for (const rows of tables(text)) for (const r of rows.slice(1)) {
      const n = parseInt(r[0], 10);
      if (n >= 1 && n <= count && r[3]) out[n - 1] = String(r[3]).trim();
    }
    return out;
  };
  const sourcesFromText = (text, count) => {
    const out = Array(count).fill(undefined);
    for (const rows of tables(text)) for (const r of rows.slice(1)) {
      const n = parseInt(r[0], 10);
      if (n >= 1 && n <= count && r[2] !== undefined) out[n - 1] = String(r[2]).trim();
    }
    return out;
  };

  // ---------- my material prices (supplier catalogues and price lists) ----------
  // { id: "M3", name, make, spec, unit, price, priceBasis, currency, supplier, listDate, updated }
  const matText = (m) => [m.name, m.spec].filter(Boolean).join(" ");
  const matLabel = (m) => [m.make, m.name, m.spec].filter(Boolean).join(" ");
  // Columns of a price list: item/product, make/brand, size/model, unit, price (net/dealer/MRP).
  function priceColumns(header) {
    const h = header.map((x) => String(x || "").toLowerCase());
    const find = (re, skip = []) => h.findIndex((x, i) => !skip.includes(i) && re.test(x));
    const price = find(/net|dealer|dlp|price|rate|mrp|cost|amount/);
    const basis = find(/basis|remark|note/, [price]);
    const make = find(/make|brand|manufacturer|company/, [price, basis]);
    const spec = find(/size|model|spec|grade|type|code|dia|thick|capacity/, [price, basis, make]);
    const unit = find(/^\s*(unit|uom|per|pack|packing)/, [price, basis, make, spec]);
    const name = find(/item|product|description|material|particular|name/, [price, basis, make, spec, unit]);
    return { name, make, spec, unit, price, basis };
  }
  function materialsFromRows(rows, { currency = "INR", supplier = "", listDate = "" } = {}) {
    for (let h = 0; h < Math.min((rows || []).length, 40); h++) {
      const header = (rows[h] || []).map(cellStr), col = priceColumns(header);
      if (col.name === -1 || col.price === -1) continue;
      const out = [];
      for (const raw of rows.slice(h + 1)) {
        const r = (raw || []).map(cellStr), price = toNumber(r[col.price]);
        if (!r[col.name] || !(price > 0) || isTotalRow([r[col.name]])) continue;
        const get = (k) => (col[k] !== -1 ? (r[col[k]] || "").replace(/^[-–—]$|^n\/?a$/i, "") : "");
        out.push({ name: r[col.name], make: get("make"), spec: get("spec"), unit: get("unit"), price, priceBasis: get("basis"), currency, supplier, listDate });
      }
      if (out.length) return out;
    }
    return [];
  }
  // The AI's copy of a catalogue: "Supplier: …", "List date: …", then | Item | Make | Size / Model | Unit | Price | Price basis |.
  function materialsFromText(text, { currency = "INR" } = {}) {
    const s = String(text || "");
    const supplier = ((s.match(/^\s*Supplier:\s*(.+)$/im) || [])[1] || "").replace(/^unknown$/i, "").trim();
    const date = ((s.match(/^\s*List date:\s*(\d{4}-\d{2}-\d{2})/im) || [])[1] || "");
    const list = tables(s).flatMap((rows) => materialsFromRows(rows, { currency, supplier, listDate: date }));
    return { supplier, listDate: date, list };
  }
  const matKey = (m) => `${tokens(matLabel(m)).join(" ")}|${normUnit(m.unit)}|${m.currency || "INR"}|${tokens(m.supplier).join(" ")}`;
  function addMaterials(materials, list, date = new Date().toISOString().slice(0, 10)) {
    const out = (materials || []).map((m) => ({ ...m }));
    const byKey = new Map(out.map((m) => [matKey(m), m]));
    let next = out.reduce((mx, m) => Math.max(mx, parseInt(String(m.id).slice(1), 10) || 0), 0), added = 0, updated = 0;
    for (const m of list || []) {
      const found = byKey.get(matKey(m));
      if (found) { if (Number(found.price) !== Number(m.price) || found.listDate !== m.listDate) { Object.assign(found, { price: Number(m.price), priceBasis: m.priceBasis || found.priceBasis, listDate: m.listDate || found.listDate, updated: date }); updated++; } }
      else { const e = { ...m, id: `M${++next}`, price: Number(m.price), updated: date }; out.push(e); byKey.set(matKey(e), e); added++; }
    }
    return { materials: out, added, updated };
  }
  // How old a price is, in days (from the list date, else when it was saved).
  const priceAgeDays = (m, today = new Date()) => { const d = Date.parse(m.listDate || m.updated || ""); return Number.isFinite(d) ? Math.floor((today - d) / 864e5) : Infinity; };
  // Material prices worth showing for a set of items: a distinctive word of the material's name
  // (cement, sand, TMT, 500d, putty, PPR …) appears in one of the item descriptions.
  const GENERIC = new Set("grade size type bar bars pipe pipes sheet sheets per bag bags box boxes pack nos mm kg new".split(" "));
  function relevantMaterials(descriptions, materials, { currency = "INR", limit = 60 } = {}) {
    const words = new Set([].concat(descriptions).flatMap((d) => tokens(d)));
    return (materials || [])
      .filter((m) => (m.currency || "INR") === currency && Number(m.price) > 0)
      .map((m) => ({ m, hit: [...new Set(tokens(m.name))].filter((w) => w.length >= 3 && !/^\d+(\.\d+)?$/.test(w) && !GENERIC.has(w) && words.has(w)).length }))
      .filter((x) => x.hit > 0)
      .sort((a, b) => b.hit - a.hit)
      .slice(0, limit)
      .map((x) => x.m);
  }
  const materialLine = (m) => `${m.id} ${matLabel(m)} = ${m.price} per ${m.unit || "unit"}${m.priceBasis ? ` (${m.priceBasis})` : ""}${m.supplier ? `, ${m.supplier}` : ""}${m.listDate ? `, ${m.listDate}` : ""}`;

  // ---------- bid summary ----------
  const lakhCrore = (num, word) => { const n = Number(String(num).replace(/,/g, "")); return /crore|cr\b/i.test(word || "") ? n * 1e7 : /lakh|lac/i.test(word || "") ? n * 1e5 : n; };
  // Numbers a tender's terms usually state; anything not found stays undefined.
  function termsFacts(text) {
    const s = String(text || "").replace(/\*\*/g, "");
    const money = (re) => { const m = s.match(re); return m ? lakhCrore(m[1], m[2]) : undefined; };
    const pct = (re) => { const m = s.match(re); return m ? Number(m[1]) : undefined; };
    const facts = {
      estimate: money(/(?:estimated cost|cost put to tender|tender value|estimated value|estimate)[^0-9\n]{0,40}?([\d,]+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr)?/i),
      emd: money(/(?:EMD|earnest money(?: deposit)?|bid security)[^0-9%\n]{0,40}?([\d,]+(?:\.\d+)?)(?!\s*%)\s*(lakhs?|lacs?|crores?|cr)?/i),
      emdPct: pct(/(?:EMD|earnest money(?: deposit)?|bid security)[^%\n]{0,40}?(\d+(?:\.\d+)?)\s*%/i),
      perfPct: pct(/performance (?:security|guarantee|bank guarantee)[^%\n]{0,60}?(\d+(?:\.\d+)?)\s*%/i),
      retentionPct: pct(/(?:security deposit|retention)[^%\n]{0,60}?(\d+(?:\.\d+)?)\s*%/i),
      months: pct(/complet[^.\n]{0,60}?(\d+)\s*(?:\([a-z ]+\)\s*)?months?/i) ?? pct(/(\d+)\s*(?:\([a-z ]+\)\s*)?months?[^.\n]{0,40}complet/i),
      validityDays: pct(/valid[^.\n]{0,60}?(\d+)\s*days/i),
      ldPctPerWeek: pct(/(\d+(?:\.\d+)?)\s*%[^.\n]{0,40}per week/i)
    };
    if (facts.emd === undefined && facts.emdPct !== undefined && facts.estimate) facts.emd = Math.round(facts.estimate * facts.emdPct / 100);
    return facts;
  }
  // b: { profitPct, cost, estimate, emd, perfPct, retentionPct, months, payDays }
  function bidSummary(q, b = {}) {
    const t = totals(q), base = t.taxable;
    const num = (v, d) => (Number.isFinite(Number(v)) && v !== "" && v !== null && v !== undefined ? Number(v) : d);
    const profitPct = num(b.profitPct, 15), months = Math.max(1, num(b.months, 6)), payDays = num(b.payDays, 45);
    const cost = num(b.cost, 0) > 0 ? Number(b.cost) : base / (1 + profitPct / 100);
    const profit = base - cost, margin = base ? (profit / base) * 100 : 0;
    const estimate = num(b.estimate, 0), vsEstimate = estimate > 0 ? (base / estimate - 1) * 100 : null;
    const emd = num(b.emd, 0), perfSec = base * num(b.perfPct, 5) / 100, retention = base * num(b.retentionPct, 5) / 100;
    const monthly = cost / months, workingCap = monthly * (1 + payDays / 30);
    const peak = Math.max(emd, perfSec) + workingCap + retention;
    const flags = [];
    if (profit < 0) flags.push({ level: "red", text: "At these rates you lose money. Raise your rates or re-check your costs." });
    else if (margin < 5) flags.push({ level: "amber", text: `Profit is thin (${margin.toFixed(1)}%). Any delay, price rise or penalty can wipe it out.` });
    if (vsEstimate !== null && vsEstimate > 10) flags.push({ level: "amber", text: `Your quote is ${vsEstimate.toFixed(1)}% above the department's estimate. Bids far above the estimate are often rejected or sent for negotiation.` });
    if (vsEstimate !== null && vsEstimate < -15) flags.push({ level: "amber", text: `Your quote is ${Math.abs(vsEstimate).toFixed(1)}% below the estimate. Very low bids may need extra performance security and are hard to finish at a profit — re-check your rates.` });
    if (profit > 0 && peak > profit * 3) flags.push({ level: "amber", text: "You need a lot of your own money compared with the profit. Plan bank credit or supplier credit before you bid." });
    return { base, tax: t.tax, total: t.total, cost, profit, margin, profitPerMonth: profit / months, estimate, vsEstimate, emd, perfSec, retention, monthly, workingCap, peak, months, payDays, flags };
  }


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
  function checkQuote(q, { materials = [], today = new Date() } = {}) {
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
    const used = [...new Set(priced.flatMap((it) => it.materials || []))].map((id) => materials.find((m) => m.id === id)).filter(Boolean);
    const old = used.filter((m) => priceAgeDays(m, today) > 90);
    if (old.length) issues.push({ level: "amber", text: `Rates use material prices older than 3 months: ${list(old.map((m) => `${matLabel(m)} (${m.listDate || m.updated})`), 4)}. Get today's price from the supplier.` });
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
  function reviewMessage(q, autoIssues = [], { materials = [] } = {}) {
    const t = totals(q), cur = q.currency || "INR";
    const days = q.validUntil && q.date ? Math.round((Date.parse(q.validUntil) - Date.parse(q.date)) / 864e5) : "";
    const lines = t.items.filter((it) => !it.heading).slice(0, 400).map((it) => `${it.ref || "-"} | ${(it.short || String(it.description)).replace(/\s+/g, " ").slice(0, 160)} | ${it.unit || ""} | ${it.qty} | ${it.rate} | ${it.amount}${it.aiRate ? " | AI rate" : ""}${it.rateBasis ? ` | built up: ${String(it.rateBasis).slice(0, 120)}` : ""}`);
    const usedIds = [...new Set(t.items.flatMap((it) => it.materials || []))];
    const usedMats = usedIds.map((id) => materials.find((m) => m.id === id)).filter(Boolean);
    return [
      `Tender key terms (plain summary):\n${q.tenderTerms ? String(q.tenderTerms).slice(0, 6000) : "Not available."}`,
      `Quotation: currency ${cur}; ${Number(q.taxRate) ? `${q.taxLabel || "tax"} ${q.taxRate}% added on top` : "no tax added"}; discount ${t.discount}; quote valid ${days} days; total ${t.total}.`,
      `Quotation terms:\n${String(q.terms || "").slice(0, 2000)}`,
      `Site / project: ${(q.client && q.client.site) || "not stated"}. Subject: ${q.subject || ""}`,
      `Items (Item No | description | unit | qty | rate | amount):\n${lines.join("\n")}`,
      `Material prices used in the rates (make, size, supplier, date): ${usedMats.length ? usedMats.map(materialLine).join("; ") : "none"}`,
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

  const api = { CURRENCIES, toNumber, money, detectCurrency, itemsFromAnswer, tenderItems, tenderItemsFromText, ratesFromText, shortsFromText, sourcesFromText, basisFromText, materialLine, materialsFromRows, materialsFromText, addMaterials, relevantMaterials, priceAgeDays, matLabel, rateRequests, similarRates, ownRateFor, addToRateBook, rateListFromRows, normUnit, fullDescription, termsFacts, bidSummary, simplifyRequests, checkQuote, reviewMessage, totals, quoteNumber, shareText, amountInWords, isTotalRow };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QUOTE = api;
})(typeof self !== "undefined" ? self : this);
