/* Consultant tools: pure calculations shared by consultant.html and the tests.
 *  - compareBids: comparative statement of contractors' priced BOQs against the tender BOQ
 *  - billItems / certifyBill: check a contractor's running bill against the agreement
 *  - bbs: bar bending schedule (cutting lengths with bend deductions, weights)
 *  - slabCheck / beamCheck / columnCheck / footingCheck: preliminary IS 456:2000 checks
 * These are checks and schedules for a qualified engineer to verify; they are not designs.
 * Needs QUOTE (assets/quote.js). */
(function (root, Q) {
  "use strict";
  const r2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;
  const r0 = (n) => Math.round(Number(n) || 0);
  const median = (arr) => { const a = arr.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return NaN; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const num = (v, d = 0) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));

  // ---------- 1. bid comparison ----------
  // base: tender items (with qty); bids: [{ name, items: pricedItems }]. Amounts are recomputed on the
  // tender quantity so every bidder is compared on the same basis ("corrected total").
  function compareBids(base, bids, { lowPct = 25, highPct = 25 } = {}) {
    const lines = (base || []).map((it, i) => ({ it, i })).filter(({ it }) => !it.heading && String(it.description || "").trim());
    const per = (bids || []).map((b) => ({ name: b.name, items: b.items || [], ...Q.matchItems(base, b.items || []) }));
    const rows = lines.map(({ it, i }) => {
      const cells = per.map((b) => {
        const k = Object.keys(b.map).find((key) => b.map[key] === i);
        if (k === undefined) return { missing: true };
        const o = b.items[k], rate = Number(o.rate), qty = num(it.qty);
        const own = Number.isFinite(Number(o.amount)) ? Number(o.amount) : NaN;
        const expectedOwn = Number(o.qty) * rate;
        return {
          rate: Number.isFinite(rate) ? rate : NaN, amount: Number.isFinite(rate) ? r2(qty * rate) : NaN, own,
          noRate: !(rate > 0),
          qtyDiffers: Number.isFinite(Number(o.qty)) && Math.abs(Number(o.qty) - qty) > 1e-6, bidQty: Number(o.qty),
          arithmetic: Number.isFinite(own) && Number.isFinite(expectedOwn) && Math.abs(own - expectedOwn) > Math.max(1, Math.abs(expectedOwn) * 0.005)
        };
      });
      const med = median(cells.filter((c) => !c.missing && c.rate > 0).map((c) => c.rate));
      cells.forEach((c) => {
        if (c.missing || !(c.rate > 0) || !(med > 0) || per.length < 3) return;
        if (c.rate < med * (1 - lowPct / 100)) c.flag = "low";
        else if (c.rate > med * (1 + highPct / 100)) c.flag = "high";
        c.vsMedianPct = (c.rate / med - 1) * 100;
      });
      return { i, ref: it.ref, description: it.description, unit: it.unit, qty: num(it.qty), median: med, cells };
    });
    const bidders = per.map((b, j) => {
      const cs = rows.map((r) => r.cells[j]);
      const corrected = r2(cs.reduce((s, c) => s + (c.missing || !(c.amount >= 0) ? 0 : c.amount), 0));
      const quoted = r2((b.items || []).filter((o) => !o.heading).reduce((s, o) => s + (Number.isFinite(Number(o.amount)) ? Number(o.amount) : (Number(o.qty) * Number(o.rate)) || 0), 0));
      return {
        name: b.name, corrected, quoted, difference: r2(quoted - corrected),
        missing: cs.filter((c) => c.missing).length, noRate: cs.filter((c) => !c.missing && c.noRate).length,
        extra: b.unmatched.length, extraLines: b.unmatched.map((k) => b.items[k]),
        qtyChanged: cs.filter((c) => c.qtyDiffers).length, arithmetic: cs.filter((c) => c.arithmetic).length,
        low: cs.filter((c) => c.flag === "low").length, high: cs.filter((c) => c.flag === "high").length
      };
    });
    const complete = bidders.filter((b) => !b.missing && !b.noRate).sort((a, b) => a.corrected - b.corrected);
    const all = bidders.slice().sort((a, b) => a.corrected - b.corrected);
    all.forEach((b) => { b.rank = complete.indexOf(b) + 1 || null; });
    return { rows, bidders, lowest: complete[0] || null, ranking: complete.map((b) => b.name) };
  }

  // ---------- 5. bill certification ----------
  // A contractor's bill sheet: item, description, unit, qty up to date, previous qty (optional), rate, amount.
  function billColumns(header) {
    const h = header.map((x) => String(x || "").toLowerCase());
    const find = (re, skip = []) => h.findIndex((x, i) => !skip.includes(i) && re.test(x));
    const rate = find(/rate|price/);
    const prev = find(/previous|prev\.?|last bill|earlier/, [rate]);
    const thisBill = find(/this bill|present|current|since/, [rate, prev]);
    const amount = find(/amount|value/, [rate, prev, thisBill]);
    const upto = find(/up ?to ?date|cumulative|to date|total qty|gross qty|qty|quantity/, [rate, prev, thisBill, amount]);
    const unit = find(/^\s*(unit|uom)/, [rate, prev, thisBill, amount, upto]);
    let ref = h.findIndex((x) => /^\s*(sl|s\.?\s*no|sr|#|item\s*(no|#|code)|no\.?)\b/.test(x));
    let desc = find(/description|particular/, [rate, prev, thisBill, amount, upto, unit, ref]);
    if (desc === -1) desc = find(/item/, [rate, prev, thisBill, amount, upto, unit, ref]);
    else if (ref === -1) ref = find(/^\s*item\s*$/, [desc]);
    return { ref, desc, unit, upto, prev, thisBill, rate, amount };
  }
  function billItems(rows) {
    const cellStr = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    for (let i = 0; i < Math.min((rows || []).length, 40); i++) {
      const header = (rows[i] || []).map(cellStr);
      if (header.filter(Boolean).length < 3) continue;
      const c = billColumns(header);
      if (c.desc === -1 || c.rate === -1 || (c.upto === -1 && (c.thisBill === -1 || c.prev === -1))) continue;
      const items = [];
      for (const raw of rows.slice(i + 1)) {
        const r = (raw || []).map(cellStr), description = r[c.desc] || "";
        if (!description || /^\d+$/.test(description) || Q.isTotalRow([description, r[c.ref] || ""])) continue;
        const thisQ = c.thisBill !== -1 ? Q.toNumber(r[c.thisBill]) : NaN;
        let prev = c.prev !== -1 ? Q.toNumber(r[c.prev]) : NaN;
        const upto = c.upto !== -1 ? Q.toNumber(r[c.upto]) : (Number.isFinite(thisQ) ? thisQ : 0) + (Number.isFinite(prev) ? prev : 0);
        if (!Number.isFinite(upto) || (c.upto === -1 && !Number.isFinite(thisQ) && !Number.isFinite(prev))) { items.push({ ref: c.ref !== -1 ? r[c.ref] : "", description, heading: true }); continue; }
        if (!Number.isFinite(prev) && Number.isFinite(thisQ)) prev = upto - thisQ;
        items.push({ ref: c.ref !== -1 ? r[c.ref] : "", description, unit: c.unit !== -1 ? r[c.unit] : "", qty: upto, prev: Number.isFinite(prev) ? prev : 0, rate: Q.toNumber(r[c.rate]), amount: c.amount !== -1 ? Q.toNumber(r[c.amount]) : NaN });
      }
      while (items.length && items[items.length - 1].heading) items.pop();
      if (items.some((x) => !x.heading)) return items;
    }
    return [];
  }
  // agreement: items with agreed qty and rate; bill: billItems; mb: { [agreementIndex]: measured qty to date }.
  function certifyBill(agreement, bill, { mb = {}, deviationPct = 25, taxRate = 0, settings = {} } = {}) {
    const { map, unmatched } = Q.matchItems(agreement, bill);
    const set = { sdPct: 2.5, itPct: 2, gstTdsPct: 0, cessPct: 1, otherLabel: "", otherAmount: 0, ...settings };
    const lines = [];
    let claimedUpto = 0, certifiedUpto = 0, certifiedPrev = 0;
    bill.forEach((b, k) => {
      if (b.heading) return;
      const claimed = r2(Number.isFinite(b.amount) ? b.amount : b.qty * (b.rate || 0));
      claimedUpto += claimed;
      const ai = map[k], reasons = [];
      if (ai === undefined) { lines.push({ k, ref: b.ref, description: b.description, unit: b.unit, claimedQty: b.qty, claimedRate: b.rate, claimed, allowedQty: 0, allowedRate: 0, certified: 0, extra: true, reasons: ["Not in the agreement — an extra item needs written approval and an agreed rate before it can be paid."] }); return; }
      const a = agreement[ai], agreedRate = Number(a.rate) || 0, agreedQty = Number(a.qty) || 0;
      let qty = b.qty;
      if (Number.isFinite(b.amount) && Number.isFinite(b.rate) && Math.abs(b.amount - b.qty * b.rate) > Math.max(1, Math.abs(b.qty * b.rate) * 0.005)) reasons.push(`Arithmetic: ${b.qty} × ${b.rate} = ${r2(b.qty * b.rate)}, not ${b.amount} as claimed.`);
      const rate = Math.min(Number.isFinite(b.rate) ? b.rate : agreedRate, agreedRate);
      if (b.rate > agreedRate + 1e-9) reasons.push(`Rate ${b.rate} claimed; agreement rate is ${agreedRate}.`);
      if (mb[ai] !== undefined && mb[ai] !== "" && Number(mb[ai]) < qty - 1e-9) { reasons.push(`Quantity ${qty} claimed; measured (MB) quantity to date is ${Number(mb[ai])}.`); qty = Number(mb[ai]); }
      const cap = agreedQty * (1 + deviationPct / 100);
      if (agreedQty > 0 && qty > cap + 1e-9) { reasons.push(`Quantity ${qty} is more than the agreement quantity ${agreedQty} + ${deviationPct}% (${r2(cap)}). The excess needs deviation approval.`); qty = cap; }
      else if (agreedQty > 0 && qty > agreedQty + 1e-9) reasons.push(`Quantity is ${r2((qty / agreedQty - 1) * 100)}% above the agreement quantity (within the ${deviationPct}% deviation limit) — confirm approval.`);
      const certified = r2(qty * rate), prevCert = r2((b.prev || 0) * Math.min(Number.isFinite(b.rate) ? b.rate : agreedRate, agreedRate));
      certifiedUpto += certified; certifiedPrev += prevCert;
      lines.push({ k, ai, ref: b.ref || a.ref, description: b.description, unit: b.unit || a.unit, claimedQty: b.qty, claimedRate: b.rate, claimed, agreedQty, agreedRate, allowedQty: r2(qty), allowedRate: rate, certified, reasons, cut: r2(claimed - certified) });
    });
    const gross = r2(certifiedUpto - certifiedPrev);
    const tax = r2(gross * Math.max(0, num(taxRate)) / 100);
    const deductions = [["Security deposit / retention", set.sdPct], ["Income tax (TDS)", set.itPct], ["GST TDS", set.gstTdsPct], ["Labour welfare cess", set.cessPct]]
      .filter(([, p]) => num(p) > 0).map(([l, p]) => ({ label: `${l} @ ${p}%`, amount: r2(gross * num(p) / 100) }));
    if (num(set.otherAmount) > 0) deductions.push({ label: set.otherLabel || "Other deduction", amount: r2(num(set.otherAmount)) });
    const totalDed = r2(deductions.reduce((s, d) => s + d.amount, 0));
    return { lines, unmatched, claimedUpto: r2(claimedUpto), certifiedUpto: r2(certifiedUpto), certifiedPrev: r2(certifiedPrev), cut: r2(claimedUpto - certifiedUpto), gross, tax, billAmount: r2(gross + tax), deductions, net: r2(gross + tax - totalDed), flagged: lines.filter((l) => l.reasons.length || l.extra).length };
  }

  // ---------- 2. bar bending schedule ----------
  // Lengths in mm. Bend deductions (IS 2502 / SP 34 practice): 45° = 1d, 90° = 2d, 135° = 3d; hooks 10d
  // for stirrups and ties. Weight = d²/162 kg/m. All assumptions are settings the engineer can change.
  const BBS_DEFAULTS = { stirrupHookD: 10, legD: 12, lapD: 50, bend90D: 2, bend135D: 3, firstStirrupMm: 50, wastagePct: 3, crankFactor: 0.42 };
  const kgPerM = (d) => (d * d) / 162;
  const stirrupLength = (w, h, cover, d, s) => { const a = w - 2 * cover - d, b = h - 2 * cover - d; return 2 * (a + b) + 2 * s.stirrupHookD * d - 3 * s.bend90D * d - 2 * s.bend135D * d; };
  const groups = (b) => (b && Array.isArray(b.parts) && b.parts.length ? b.parts : [{ n: num(b && b.n), dia: num(b && b.dia) }]);
  function bbs(members, settings = {}) {
    const s = { ...BBS_DEFAULTS, ...settings }, bars = [], problems = [];
    let n = 0;
    const add = (m, label, dia, shape, perMember, cutMm, formula) => {
      if (!(dia > 0) || !(perMember > 0) || !(cutMm > 0)) return;
      n += 1;
      const total = perMember * num(m.count, 1), lengthM = (total * cutMm) / 1000;
      bars.push({ barMark: `${m.mark || m.type}-${String(n).padStart(2, "0")}`, member: m.mark || m.type, type: m.type, label, dia, shape, perMember, members: num(m.count, 1), total, cutMm: r0(cutMm), totalM: r2(lengthM), kg: r2(lengthM * kgPerM(dia)), formula });
    };
    for (const m of members || []) {
      const cover = num(m.cover, m.type === "footing" ? 50 : m.type === "column" ? 40 : m.type === "slab" ? 20 : 25);
      const sup = num(m.support, 230);
      if (m.type === "beam") {
        const L = num(m.length), w = num(m.width), h = num(m.depth);
        if (!(L > 0 && w > 2 * cover && h > 2 * cover)) { problems.push(`${m.mark || "Beam"}: enter span, width and depth (more than twice the cover).`); continue; }
        for (const [k, label] of [["bottom", "Bottom bars"], ["top", "Top bars"]]) {
          for (const g of groups(m[k])) {
            const d = g.dia, cut = L + 2 * (sup - cover) + 2 * s.legD * d - 2 * s.bend90D * d;
            add(m, label, d, "Straight with L-bends at both ends", g.n, cut, `${L} + 2×(${sup} − ${cover}) + 2×${s.legD}d − 2×${s.bend90D}d`);
          }
        }
        const st = m.stirrup || {}, sd = num(st.dia), sp = num(st.spacing);
        if (sd > 0 && sp > 0) add(m, "Stirrups", sd, "Closed stirrup, 135° hooks", Math.floor((L - 2 * s.firstStirrupMm) / sp) + 1, stirrupLength(w, h, cover, sd, s), `2(a+b) + 2×${s.stirrupHookD}d − 3×${s.bend90D}d − 2×${s.bend135D}d`);
      } else if (m.type === "column") {
        const H = num(m.height), w = num(m.width), h = num(m.depth);
        if (!(H > 0 && w > 2 * cover && h > 2 * cover)) { problems.push(`${m.mark || "Column"}: enter height, width and depth.`); continue; }
        for (const g of groups(m.main)) add(m, "Main bars", g.dia, "Straight with lap", g.n, H + s.lapD * g.dia, `${H} + lap ${s.lapD}d`);
        const t = m.tie || {}, td = num(t.dia), tsp = num(t.spacing);
        if (td > 0 && tsp > 0) add(m, "Ties", td, "Closed tie, 135° hooks", Math.floor(H / tsp) + 1, stirrupLength(w, h, cover, td, s), `2(a+b) + 2×${s.stirrupHookD}d − 3×${s.bend90D}d − 2×${s.bend135D}d`);
      } else if (m.type === "slab") {
        const lx = num(m.lx), ly = num(m.ly), D = num(m.thickness);
        if (!(lx > 0 && ly > 0 && D > 2 * cover)) { problems.push(`${m.mark || "Slab"}: enter both spans and the thickness.`); continue; }
        const mn = m.main || {}, md = num(mn.dia), msp = num(mn.spacing);
        if (md > 0 && msp > 0) {
          const count = Math.floor((ly - 2 * cover) / msp) + 1, straight = lx + 2 * (sup - cover);
          if (m.cranked) {
            const crank = 2 * s.crankFactor * (D - 2 * cover - md);
            add(m, "Main bars (straight)", md, "Straight", Math.ceil(count / 2), straight, `${lx} + 2×(${sup} − ${cover})`);
            add(m, "Main bars (cranked)", md, "Cranked at both ends", Math.floor(count / 2), straight + crank, `${lx} + 2×(${sup} − ${cover}) + 2×${s.crankFactor}×(${D} − 2×${cover} − ${md})`);
          } else add(m, "Main bars", md, "Straight", count, straight, `${lx} + 2×(${sup} − ${cover})`);
        }
        const ds = m.dist || {}, dd = num(ds.dia), dsp = num(ds.spacing);
        if (dd > 0 && dsp > 0) add(m, "Distribution bars", dd, "Straight", Math.floor((lx - 2 * cover) / dsp) + 1, ly + 2 * (sup - cover), `${ly} + 2×(${sup} − ${cover})`);
      } else if (m.type === "footing") {
        const L = num(m.length), B = num(m.width), D = num(m.depth);
        if (!(L > 2 * cover && B > 2 * cover && D > 2 * cover)) { problems.push(`${m.mark || "Footing"}: enter length, width and depth.`); continue; }
        for (const [k, label, along, across] of [["barsL", "Bars along length", L, B], ["barsB", "Bars along width", B, L]]) {
          const b = m[k] || {}, d = num(b.dia), sp = num(b.spacing);
          if (d > 0 && sp > 0) add(m, label, d, "Bent up at both ends", Math.floor((across - 2 * cover) / sp) + 1, along - 2 * cover + 2 * (D - 2 * cover) - 2 * s.bend90D * d, `${along} − 2×${cover} + 2×(${D} − 2×${cover}) − 2×${s.bend90D}d`);
        }
      }
    }
    const byDia = {};
    bars.forEach((b) => { byDia[b.dia] = r2((byDia[b.dia] || 0) + b.kg); });
    const totalKg = r2(Object.values(byDia).reduce((a, b) => a + b, 0));
    return { bars, byDia, totalKg, withWastage: r2(totalKg * (1 + s.wastagePct / 100)), problems, settings: s };
  }

  // ---------- 3. preliminary IS 456:2000 checks ----------
  const BASIC_SPAN_DEPTH = { cantilever: 7, simple: 20, continuous: 26 };   // cl 23.2.1 (a)
  const res = (name, ok, text, clause) => ({ name, ok, text, clause });
  function spanDepth({ spanMm, support = "simple", mf = 1.2 }) {
    let basic = BASIC_SPAN_DEPTH[support] || 20;
    let factor = 1;
    if (support !== "cantilever" && spanMm > 10000) factor = 10000 / spanMm;   // cl 23.2.1 (b)
    const dReq = spanMm / (basic * num(mf, 1) * factor);
    return { basic, factor, dReq };
  }
  function slabCheck({ spanMm, support = "simple", mf = 1.2, coverMm = 20, barDia = 10, providedD }) {
    const { basic, factor, dReq } = spanDepth({ spanMm, support, mf });
    const Dreq = dReq + coverMm + barDia / 2, out = [];
    out.push(res("Effective depth for deflection", providedD - coverMm - barDia / 2 >= dReq - 0.5,
      `Required d = L ÷ (basic ${basic} × MF ${mf}${factor < 1 ? ` × ${r2(factor)}` : ""}) = ${r0(dReq)} mm → overall D ≥ ${r0(Dreq)} mm; provided D = ${providedD} mm.`, "IS 456 cl 23.2.1, 24.1"));
    out.push(res("Minimum thickness / cover", providedD >= 100 && coverMm >= 15, `Provided D = ${providedD} mm, nominal cover ${coverMm} mm (mild exposure: 20 mm; 15 mm for bars up to 12 mm).`, "IS 456 cl 26.4.2, Table 16"));
    out.push(res("Minimum steel", true, `Ast,min = 0.12% of bD for Fe 415/500 = ${r0(0.0012 * 1000 * providedD)} mm² per metre width.`, "IS 456 cl 26.5.2.1"));
    out.push(res("Maximum bar spacing", true, `Main bars ≤ 3d or 300 mm (= ${r0(Math.min(3 * (providedD - coverMm - barDia / 2), 300))} mm); distribution ≤ 5d or 450 mm.`, "IS 456 cl 26.3.3 (b)"));
    return { dReq: r0(dReq), Dreq: r0(Dreq), results: out };
  }
  function beamCheck({ spanMm, support = "simple", mf = 1.2, b, D, coverMm = 25, barDia = 16, fy = 500, bars = 0 }) {
    const { basic, factor, dReq } = spanDepth({ spanMm, support, mf });
    const d = D - coverMm - 8 - barDia / 2, out = [];
    out.push(res("Effective depth for deflection", d >= dReq - 0.5, `Required d = ${spanMm} ÷ (${basic} × ${mf}${factor < 1 ? ` × ${r2(factor)}` : ""}) = ${r0(dReq)} mm; provided d ≈ ${r0(d)} mm (D ${D} − cover ${coverMm} − stirrup 8 − bar/2).`, "IS 456 cl 23.2.1"));
    const astMin = (0.85 * b * d) / fy, astMax = 0.04 * b * D, ast = num(bars) * Math.PI * barDia * barDia / 4;
    if (bars > 0) out.push(res("Tension steel within limits", ast >= astMin && ast <= astMax, `Provided ${bars} × ${barDia} mm = ${r0(ast)} mm²; min 0.85bd/fy = ${r0(astMin)} mm², max 0.04bD = ${r0(astMax)} mm².`, "IS 456 cl 26.5.1.1"));
    else out.push(res("Tension steel limits", true, `Min 0.85bd/fy = ${r0(astMin)} mm²; max 0.04bD = ${r0(astMax)} mm².`, "IS 456 cl 26.5.1.1"));
    out.push(res("Lateral stability", spanMm <= Math.min(60 * b, (250 * b * b) / d), `Clear distance between lateral restraints ≤ 60b = ${r0(60 * b)} mm and 250b²/d = ${r0((250 * b * b) / d)} mm (simply supported / continuous).`, "IS 456 cl 23.3"));
    return { dReq: r0(dReq), astMin: r0(astMin), astMax: r0(astMax), results: out };
  }
  function columnCheck({ b, D, lexMm, leyMm, fck = 25, fy = 500, nBars = 4, barDia = 16, tieDia = 8, tieSpacing = 150, PuKN }) {
    const Asc = nBars * Math.PI * barDia * barDia / 4, Ag = b * D, pct = (100 * Asc) / Ag, out = [];
    const ac = Ag - Asc, PuCap = (0.4 * fck * ac + 0.67 * fy * Asc) / 1000;
    const slx = num(lexMm) / D, sly = num(leyMm || lexMm) / b;
    out.push(res("Short column", slx <= 12 && sly <= 12, `lex/D = ${r2(slx)}, ley/b = ${r2(sly)} (short if both ≤ 12; otherwise design as slender with additional moments).`, "IS 456 cl 25.1.2"));
    const emin = Math.max(num(lexMm) / 500 + D / 30, 20);
    out.push(res("Minimum eccentricity", emin <= 0.05 * D, `e,min = l/500 + D/30 = ${r2(emin)} mm vs 0.05D = ${r2(0.05 * D)} mm. The simplified capacity formula applies only if e,min ≤ 0.05D; otherwise check for axial load with moment.`, "IS 456 cl 25.4, 39.3"));
    if (num(PuKN) > 0) out.push(res("Axial capacity", PuCap >= PuKN, `Pu,cap = 0.4 fck Ac + 0.67 fy Asc = ${r0(PuCap)} kN vs factored load ${PuKN} kN.`, "IS 456 cl 39.3"));
    out.push(res("Longitudinal steel", pct >= 0.8 && pct <= 4 && nBars >= 4 && barDia >= 12, `${nBars} × ${barDia} mm = ${r0(Asc)} mm² = ${r2(pct)}% (0.8% to 4% recommended max; at least 4 bars of 12 mm).`, "IS 456 cl 26.5.3.1"));
    const maxSp = Math.min(b, D, 16 * barDia, 300);
    out.push(res("Ties", tieDia >= Math.max(barDia / 4, 6) && tieSpacing <= maxSp, `Tie ${tieDia} mm @ ${tieSpacing} mm; need dia ≥ max(φ/4, 6) = ${Math.max(barDia / 4, 6)} mm and spacing ≤ min(least side, 16φ, 300) = ${maxSp} mm.`, "IS 456 cl 26.5.3.2"));
    return { capacityKN: r0(PuCap), steelPct: r2(pct), results: out };
  }
  function footingCheck({ PkN, sbc, selfWtPct = 10, L, B, D, coverMm = 50, barDia = 12, colB, colD, fck = 25 }) {
    const out = [], Lm = L / 1000, Bm = B / 1000;
    const areaReq = (PkN * (1 + selfWtPct / 100)) / sbc, areaProv = Lm * Bm;
    out.push(res("Plan area for bearing", areaProv >= areaReq, `Required = P × (1 + ${selfWtPct}%) ÷ SBC = ${r2(areaReq)} m² (about ${r2(Math.sqrt(areaReq))} m square); provided ${r2(Lm)} × ${r2(Bm)} = ${r2(areaProv)} m².`, "IS 456 cl 34.1"));
    const qu = (1.5 * PkN) / areaProv, d = D - coverMm - barDia;
    out.push(res("Edge thickness", D >= 150, `Overall depth ${D} mm (thickness at the edge ≥ 150 mm on soil).`, "IS 456 cl 34.1.2"));
    const bo = 2 * (colB + d + colD + d), Vu = qu * (areaProv - ((colB + d) / 1000) * ((colD + d) / 1000)) * 1000, tv = Vu / (bo * d), tc = 0.25 * Math.sqrt(fck);
    out.push(res("Punching shear", tv <= tc, `Net upward qu = 1.5P/A = ${r2(qu)} kN/m²; at d/2 from the column τv = ${r2(tv)} N/mm² vs τc = 0.25√fck = ${r2(tc)} N/mm² (ks = 1 for a square-ish column).`, "IS 456 cl 31.6.3"));
    return { areaReq: r2(areaReq), qu: r2(qu), results: out };
  }

  // ---------- reading AI replies ----------
  // The first Markdown table of a reply as rows (header first), ready for pricedItems / billItems.
  const tableRows = (text) => (Q.tables(text)[0] || []);
  // "3-16", "2-16+1-12", "3 nos 16", "3#16", "3T16" → { n, dia } (mixed bars: the larger diameter, all bars counted
  // separately in `parts`); "10@150", "T10-150", "8 mm @ 150 c/c" → { dia, spacing }.
  function parseBars(text) {
    const s = String(text || "").replace(/mm|nos?\.?|Ø|φ|dia\.?/gi, " ").replace(/\s+/g, " ").trim();
    if (!s) return null;
    const sp = s.match(/(?:[TYRF#]\s*)?(\d{1,2})\s*(?:@|-\s*(?=\d{2,3}\b)|at\s)\s*(\d{2,3})\s*(?:c\/?c)?/i);
    if (sp && !/^\d+\s*[-#TY]\s*\d+\s*\+/.test(s) && Number(sp[2]) >= 50) return { dia: Number(sp[1]), spacing: Number(sp[2]) };
    const parts = [...s.matchAll(/(\d{1,3})\s*(?:-|#|x|×|\s)\s*[TYRF#]?\s*(\d{1,2})\b/gi)].map((m) => ({ n: Number(m[1]), dia: Number(m[2]) })).filter((p) => p.dia >= 6 && p.dia <= 40);
    if (!parts.length) return null;
    return { n: parts.reduce((a, p) => a + p.n, 0), dia: Math.max(...parts.map((p) => p.dia)), parts };
  }
  // The bbs-members table → plain rows { mark, type, count, L, B, D, main, top, st, notes } (what the page's
  // member editor shows), and one row → a member object for bbs(). Mixed bar groups keep each diameter.
  function memberRowsFromText(text) {
    const rows = tableRows(text);
    if (rows.length < 2) return [];
    const h = rows[0].map((x) => String(x).toLowerCase());
    const col = (re) => h.findIndex((x) => re.test(x));
    const c = { mark: col(/mark/), type: col(/type/), count: col(/count|nos/), L: col(/length|height/), B: col(/width|ly/), D: col(/depth|thick/), main: col(/^main/), top: col(/top|distribution/), st: col(/stirrup|tie/), notes: col(/note/) };
    return rows.slice(1).map((r) => {
      const o = {};
      for (const k of Object.keys(c)) o[k] = c[k] === -1 ? "" : String(r[c[k]] || "").trim();
      o.type = o.type.toLowerCase().replace(/s$/, "");
      return o;
    }).filter((o) => ["beam", "column", "slab", "footing"].includes(o.type));
  }
  function memberFromRow(o) {
    const type = String(o.type || "").toLowerCase();
    const m = { mark: String(o.mark || "").trim() || type, type, count: Q.toNumber(o.count) || 1, notes: o.notes || "" };
    if (o.cover !== undefined && o.cover !== "") m.cover = Number(o.cover);
    if (o.support !== undefined && o.support !== "") m.support = Number(o.support);
    const n = (v) => { const x = Q.toNumber(v); return Number.isFinite(x) ? x : 0; };
    const L = n(o.L), B = n(o.B), D = n(o.D);
    const bars = (t) => { const b = parseBars(t); return b && b.n ? { dia: b.dia, n: b.n, parts: b.parts } : b && b.spacing ? { dia: b.dia, spacing: b.spacing } : {}; };
    if (type === "beam") Object.assign(m, { length: L, width: B, depth: D, bottom: bars(o.main), top: bars(o.top), stirrup: bars(o.st) });
    if (type === "column") Object.assign(m, { height: L, width: B, depth: D, main: bars(o.main), tie: bars(o.st) });
    if (type === "slab") Object.assign(m, { lx: L, ly: B, thickness: D, main: bars(o.main), dist: bars(o.top), cranked: o.cranked === true || /crank|bent/i.test(m.notes) });
    if (type === "footing") Object.assign(m, { length: L, width: B, depth: D, barsL: bars(o.main), barsB: bars(o.top) });
    return m;
  }
  const membersFromText = (text) => memberRowsFromText(text).map(memberFromRow);

  // ---------- spec writer: what the AI gets ----------
  function projectLines(p = {}) {
    return [["Name of work", p.name], ["Client", p.client], ["Location / country", p.location], ["Estimated cost", p.cost], ["Completion period", p.period], ["Contract type", p.contractType], ["Approved makes / client standards", p.makes], ["Other notes", p.notes]]
      .filter(([, v]) => String(v || "").trim()).map(([k, v]) => `${k}: ${String(v).trim()}`).join("\n");
  }
  function specMessage(project, items) {
    const list = (items || []).filter((x) => !x.heading && String(x.description || "").trim()).map((x, i) => `${x.ref || i + 1}. ${Q.fullDescription(items, items.indexOf(x)).slice(0, 600)} (unit: ${x.unit || "—"})`).join("\n");
    return `Project:\n${projectLines(project) || "(no details given)"}\n\nBOQ items:\n${list}\n\nWrite the technical specifications for these items.`;
  }
  function conditionsMessage(project, items) {
    const heads = (items || []).filter((x) => x.heading).map((x) => x.description).slice(0, 30);
    const n = (items || []).filter((x) => !x.heading).length;
    return `Project:\n${projectLines(project) || "(no details given)"}\n\nBOQ summary: ${n} items${heads.length ? `; sections: ${heads.join("; ")}` : ""}.\n\nDraft the tender documents.`;
  }

  // Headings, bold, numbered and bullet lists and paragraphs → HTML. Everything is escaped first, so
  // nothing in an AI reply can become a tag or a script.
  function mdToHtml(md) {
    const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, "$1<em>$2</em>");
    const out = [];
    let list = null;
    const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of String(md || "").replace(/\r/g, "").split("\n")) {
      const line = raw.trimEnd();
      let m;
      if (!line.trim()) { close(); continue; }
      if ((m = line.match(/^\s*(#{1,4})\s+(.*)$/))) { close(); const lv = Math.min(4, m[1].length + 1); out.push(`<h${lv}>${inline(m[2])}</h${lv}>`); continue; }
      if ((m = line.match(/^\s*(\d{1,2}(?:\.\d{1,2})*)(?:[.)]|(?<=\.\d{1,2}))\s+(.*)$/))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li value="${parseInt(m[1], 10)}"><span class="num">${esc(m[1])}</span> ${inline(m[2])}</li>`); continue; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
      close(); out.push(`<p>${inline(line)}</p>`);
    }
    close();
    return out.join("\n");
  }

  // ---------- Excel sheets (arrays of rows) ----------
  function comparisonSheet(cmp, { title = "Comparative statement" } = {}) {
    const names = cmp.bidders.map((b) => b.name);
    const out = [[title], [], ["Item", "Description", "Unit", "Qty", ...names.flatMap((n) => [`${n} rate`, `${n} amount`]), "Median rate", "Remarks"]];
    for (const r of cmp.rows) {
      const remarks = r.cells.map((c, j) => c.missing ? `${names[j]}: not quoted` : c.noRate ? `${names[j]}: no rate` : c.flag ? `${names[j]}: ${Math.round(c.vsMedianPct)}% vs median` : c.arithmetic ? `${names[j]}: arithmetic error` : c.qtyDiffers ? `${names[j]}: qty ${c.bidQty}` : "").filter(Boolean).join("; ");
      out.push([r.ref || "", r.description, r.unit || "", r.qty, ...r.cells.flatMap((c) => (c.missing ? ["—", ""] : [c.rate, c.amount])), Number.isFinite(r.median) ? r2(r.median) : "", remarks]);
    }
    out.push([], ["", "Corrected total (tender quantities × quoted rates)", "", "", ...cmp.bidders.flatMap((b) => ["", b.corrected])]);
    out.push(["", "Total as quoted by the bidder", "", "", ...cmp.bidders.flatMap((b) => ["", b.quoted])]);
    out.push(["", "Rank (complete bids only)", "", "", ...cmp.bidders.flatMap((b) => ["", b.rank ? `L${b.rank}` : "incomplete"])]);
    return out;
  }
  function certificateSheet(cert, { title = "Bill certification" } = {}) {
    const out = [[title], [], ["Item", "Description", "Unit", "Agreement qty", "Agreement rate", "Claimed qty", "Claimed rate", "Claimed amount", "Certified qty", "Certified rate", "Certified amount", "Cut", "Remarks"]];
    for (const l of cert.lines) out.push([l.ref || "", l.description, l.unit || "", l.agreedQty ?? "", l.agreedRate ?? "", l.claimedQty, l.claimedRate, l.claimed, l.allowedQty, l.allowedRate, l.certified, l.cut ?? l.claimed, l.reasons.join(" ")]);
    out.push([], ["", "Claimed up to date", ...Array(9).fill(""), cert.claimedUpto], ["", "Certified up to date", ...Array(9).fill(""), cert.certifiedUpto], ["", "Less: certified in previous bills", ...Array(9).fill(""), cert.certifiedPrev], ["", "Gross amount of this bill", ...Array(9).fill(""), cert.gross]);
    if (cert.tax) out.push(["", "Add: tax", ...Array(9).fill(""), cert.tax]);
    cert.deductions.forEach((d) => out.push(["", `Less: ${d.label}`, ...Array(9).fill(""), d.amount]));
    out.push(["", "Net payable", ...Array(9).fill(""), cert.net]);
    return out;
  }
  function bbsSheet(res, { title = "Bar bending schedule" } = {}) {
    const out = [[title], [], ["Bar mark", "Member", "Bar", "Shape", "Dia (mm)", "No. per member", "Members", "Total bars", "Cutting length (mm)", "Total length (m)", "Weight (kg)", "Formula"]];
    res.bars.forEach((b) => out.push([b.barMark, b.member, b.label, b.shape, b.dia, b.perMember, b.members, b.total, b.cutMm, b.totalM, b.kg, b.formula]));
    out.push([], ["Summary by diameter"], ["Dia (mm)", "kg/m", "Weight (kg)"]);
    Object.keys(res.byDia).map(Number).sort((a, b) => a - b).forEach((d) => out.push([d, r2(kgPerM(d) * 1000) / 1000, res.byDia[d]]));
    out.push(["Total", "", res.totalKg], [`With ${res.settings.wastagePct}% wastage`, "", res.withWastage]);
    return out;
  }

  const api = { compareBids, billColumns, billItems, certifyBill, bbs, BBS_DEFAULTS, kgPerM, slabCheck, beamCheck, columnCheck, footingCheck, median,
    tableRows, parseBars, memberRowsFromText, memberFromRow, membersFromText, specMessage, conditionsMessage, mdToHtml, comparisonSheet, certificateSheet, bbsSheet };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CONSULT = api;
})(typeof self !== "undefined" ? self : this, typeof module === "object" && module.exports ? require("./quote.js") : (typeof self !== "undefined" ? self : this).QUOTE);
