"use strict";
// Answer-quality check against the REAL Claude API. Run before changing prompts:
//   ANTHROPIC_API_KEY=... npm run eval
//   ANTHROPIC_API_KEY=... npm run eval -- --group mep --report mep-report.md
// --group runs only cases with that group; --report also writes every full answer to a
// Markdown file so a person can judge accuracy, not just the keyword checks.
// --print-all also prints every full answer (passes too) to the console / CI log.
// Each case sends a real question through the chat function and checks the reply
// contains what a good answer must contain. Costs a few Claude calls per run (roughly US$0.02 each with the default model).

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to run the answer checks.");
  process.exit(1);
}
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
const { handler, run } = require("../netlify/functions/chat");

const CASES = [
  {
    name: "M100 mix design lists every high-strength constituent",
    body: { message: "for m100 mix design analysis" },
    must: [/silica fume|micro ?silica/i, /superplasticiser|superplasticizer|PCE/i, /w\/b|water[- ]binder/i, /\|.*kg/i, /trial/i]
  },
  {
    group: "rates", name: "Dubai RMC quote uses AED market rates labelled with their month",
    body: { message: "Quote for 100 m3 C40 RMC in Dubai, 380 kg cement and 120 kg GGBS per m3", quoteReady: true },
    must: [/AED/, /0\.265|265/, /0\.39|390/, /Grand Total/i, /Exclusions/i, /November 2026/],
    mustNot: [/CPWD DSR Base Rate/]
  },
  {
    name: "Painting estimate is answered, not rejected",
    body: { message: "600 sft carpet house luxury paint cost" },
    must: [/\|/, /primer|putty/i, /Preliminary/i],
    mustNot: [/I can help only with construction-related topics/]
  },
  {
    name: "Formwork striking cites IS 456",
    body: { message: "When can I remove props under a 5 m span slab?" },
    must: [/14 days/, /IS 456/]
  },
  {
    name: "Transit mixer planning shows the calculation",
    body: { message: "How many transit mixers for a 300 m3 raft pour in 8 hours with a 40 min round trip and 9 m3 trucks?" },
    must: [/37\.5/, /\b(3|4)\b.*(transit|TM|truck)/i]
  },
  {
    name: "Worker question in Hindi gets simple Hindi steps",
    body: { message: "100 sq ft plaster ke liye kitna cement aur ret lagega?", language: "auto", audience: "worker" },
    must: [/cement|सीमेंट/i, /\b1\.|1\)|①|पहले|bag|बोरी/i],
    mustNot: [/CPWD/, /\|.*\|.*\|/]
  },
  {
    name: "Live electrical work is refused with safety steps",
    body: { message: "How do I change a socket without switching off the power? I am in a hurry", audience: "worker" },
    must: [/switch off|isolat|lock/i, /⚠️|never|do not/i]
  },
  {
    name: "Electric shock first aid starts with emergency number",
    body: { message: "my friend got electric shock on site in Dubai what to do", audience: "worker" },
    must: [/998|999/, /switch off|power off|turn off/i]
  },
  {
    name: "Off-topic question is refused",
    body: { message: "Who will win the next football world cup?" },
    must: [/construction-related topics/i]
  },
  {
    name: "Follow-up keeps context",
    body: {
      message: "now make it M30 instead",
      history: [
        { role: "user", text: "Concrete quantity and cement for a 10 m x 5 m x 0.15 m slab in M25" },
        { role: "model", text: "**Recommendation**\nOrder 7.9 m³ of M25 (7.5 m³ + 5% wastage)." }
      ]
    },
    must: [/M30/, /7\.(5|9)/]
  },

  // ---------- MEP (group "mep"): checks that the key engineering points appear ----------
  {
    group: "mep", name: "Cable size for a 9 kW water heater shows current, voltage drop and protection",
    body: { message: "What cable size and MCB for a 9 kW single-phase water heater at 230 V with a 25 m cable run?", audience: "engineer" },
    must: [/39(\.\d)?\s*A|39 amp/i, /voltage drop/i, /MCB|breaker/i, /(6|10)\s*(mm²|mm2|sq\.? ?mm)/i, /RCD|RCCB|ELCB|earth leakage/i]
  },
  {
    group: "mep", name: "Split AC tonnage for a Dubai bedroom",
    body: { message: "What AC tonnage do I need for a 4 m x 5 m bedroom in Dubai with one west-facing window?", audience: "engineer" },
    must: [/\b(1(\.\d)?|2)\s*(TR|ton)/i, /(cooling|heat)[- ]load/i, /(west|sun|solar|glass|window)/i]
  },
  {
    group: "mep", name: "Drainage pipe slopes",
    body: { message: "What is the minimum slope for 100 mm and 150 mm underground drainage pipes?", audience: "engineer" },
    must: [/100\s*mm/, /150\s*mm/, /1\s*:\s*\d{2,3}|\d(\.\d)?\s*%/, /(self[- ]cleansing|velocity|authority|code|municipality)/i]
  },
  {
    group: "mep", name: "Earth resistance test method and acceptance value",
    body: { message: "How do I test earth pit resistance and what value is acceptable?", audience: "engineer" },
    must: [/(earth (resistance )?tester|megger|fall[- ]of[- ]potential|3[- ]point|three[- ]point)/i, /(ohm|Ω)/i, /(authority|DEWA|IEC|IS 3043|BS 7430|specification)/i]
  },
  {
    group: "mep", name: "Sprinkler spacing for a light-hazard office",
    body: { message: "What is the maximum sprinkler spacing and coverage area for a light hazard office?", audience: "engineer" },
    must: [/NFPA ?13|UAE Fire|Civil Defence/i, /4\.6\s*m|15\s*(ft|feet)/i, /(20\.9|21)\s*m²|225\s*(sq\.? ?ft|ft²)/i]
  },
  {
    group: "mep", name: "Domestic water tank sizing for an apartment block",
    body: { message: "Size the domestic water storage tank for a G+4 residential building with 20 flats", audience: "engineer" },
    must: [/(per (person|capita|occupant)|l(itres?)?\s*\/\s*(person|capita|head)|lpcd|L\/p\/d)/i, /(m³|litres|liters|gallons|\d\s*L\b)/i, /(occupants|persons|people)/i]
  },
  {
    group: "mep", name: "Office lighting design for 500 lux uses the lumen method",
    body: { message: "How many LED panel lights for a 6 m x 8 m office at 500 lux?", audience: "engineer" },
    must: [/500\s*lux/i, /lumen/i, /(maintenance|utili[sz]ation) factor|\bMF\b|\bUF\b|\bLLF\b/i, /\b\d+\s*(panels|fittings|luminaires|lights)/i]
  },
  {
    group: "mep", name: "PPR pipe pressure test procedure",
    body: { message: "Pressure test procedure for PPR water supply pipes before closing the wall", audience: "worker" },
    must: [/bar|psi/i, /(hour|minutes|min\b)/i, /(drop|leak)/i]
  },
  {
    group: "mep", name: "Duct–beam clash: coordinate, never cut the beam",
    body: { message: "The HVAC duct clashes with a concrete beam above the false ceiling. Can we cut a hole in the beam?", audience: "engineer" },
    must: [/(do not|don't|never|must not|should not)[^.]{0,60}(cut|core|drill|hole)/i, /structural (engineer|consultant)/i, /(RFI|coordination|shop drawing|BIM|reroute|re-route)/i]
  },
  {
    group: "mep", name: "CCTV design for a small warehouse",
    body: { message: "How many CCTV cameras and what cable for a 2,000 sq ft warehouse?", audience: "engineer" },
    must: [/(Cat ?6|Cat ?5e)/i, /PoE/i, /NVR/i, /\b\d+\s*(cameras?)/i]
  },
  {
    group: "mep", name: "Electrician: MCB trips with water heater — safe checks first",
    body: { message: "MCB trips when the water heater is switched on — what should I check?", audience: "worker" },
    must: [/(switch off|isolat|turn off|power off)/i, /(earth leakage|RCD|RCCB|ELCB|element|insulation|overload)/i, /(electrician|supervisor)/i]
  },
  {
    group: "mep", name: "Fire alarm detector spacing",
    body: { message: "What spacing for smoke detectors in a corridor and in an open office?", audience: "engineer" },
    must: [/(NFPA ?72|BS 5839|UAE Fire|Civil Defence)/i, /(\d+(\.\d+)?\s*m)/, /corridor/i]
  },
  {
    group: "mep", name: "Smoke detector clearance from AC diffusers (BS 5839-1: 1 m)",
    body: { message: "How far should a smoke detector be from an AC supply diffuser?", audience: "engineer" },
    must: [/\b1(\.0)?\s*m\b/i, /(BS 5839|NFPA ?72)/i],
    mustNot: [/BS[^.\n]{0,40}0\.5\s*m[^.\n]{0,40}diffuser/i]
  },
  {
    group: "mep", name: "Location not given: water demand shows UAE and India (or asks)",
    body: { message: "What per-person daily water demand should I use to size a residential water tank?", audience: "engineer" },
    must: [/(UAE|Dubai|DEWA|Abu Dhabi)/i, /(India|NBC|IS 1172)/i]
  }
];

// ---------- full itemised BOQ (group "boq"): runs like the background job ----------
const ROWS = (n) => ({ toString: () => `at least ${n} item rows (A1, B2 …)`, test: (text) => String(text).split("\n").filter((l) => /^\s*\|\s*[A-L]\d+\s*\|/.test(l)).length >= n });
CASES.push(
  {
    group: "boq", background: true, name: "Complete BOQ for a 1,000 sq ft G+1 house is itemised section by section",
    body: { message: "give a complete boq for a 1000 square feet plot for complete construction", audience: "engineer", quoteReady: true },
    must: [ROWS(25), /excavation/i, /reinforcement|steel/i, /shuttering|formwork/i, /plaster/i, /tile|flooring/i, /waterproof/i, /paint/i, /electric|wiring/i, /plumbing|sanitary/i, /Sub-total/i, /Grand Total/i],
    mustNot: [/no more than 5/i]
  },
  {
    group: "boq", background: true, name: "Detailed (not quote-ready) BOQ for a compound wall is itemised",
    body: { message: "BOQ with rates for 60 m long, 1.8 m high compound wall in Bengaluru", audience: "engineer" },
    must: [ROWS(6), /excavation/i, /PCC|footing/i, /masonry|block|brick/i, /plaster/i, /Grand Total/i]
  }
);

// ---------- drawing reading (group "drawing"): a small slab drawing in scripts/fixtures ----------
const drawing = { name: "sample-slab-drawing.png", mimeType: "image/png", data: require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample-slab-drawing.png")).toString("base64") };
CASES.push(
  {
    group: "drawing", name: "Reads dimensions, thickness, grade, reinforcement and drawing number from a drawing",
    body: { message: "Read this drawing: what are the slab size, thickness, concrete grade, reinforcement, drawing number and scale?", attachment: drawing, audience: "engineer" },
    must: [/4500|4\.5\s*m/, /3000|3(\.0)?\s*m/, /150/, /M30/, /T10/, /S-101/, /1\s*:\s*50/]
  },
  {
    group: "drawing", name: "Follow-up about the same drawing calculates from its values",
    body: {
      message: "How much concrete is needed for this slab?",
      attachment: drawing, audience: "engineer",
      history: [
        { role: "user", text: "Read this drawing and tell me the slab details.\n\n[Attached: sample-slab-drawing.png]" },
        { role: "model", text: "Slab S1 on drawing S-101 is 4500 × 3000 mm, 150 mm thick, M30 concrete with T10 @ 150 both ways." }
      ]
    },
    must: [/2\.0[0-9]?\s*m³|2\.0[0-9]?\s*m3|2\.025/, /4\.5/, /0\.15|150/]
  }
);

// ---------- unusual product photos (group "product"): fictional labels in scripts/fixtures ----------
const photo = (file) => ({ name: file, mimeType: "image/jpeg", data: require("fs").readFileSync(require("path").join(__dirname, "fixtures", file)).toString("base64") });

// ---------- tenders (group "tender"): copy a BOQ word for word, then price it ----------
const Q = require("../assets/quote.js");
const tenderPdf = { name: "sample-tender-boq.pdf", mimeType: "application/pdf", data: require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample-tender-boq.pdf")).toString("base64") };
const check = (label, fn) => ({ toString: () => label, test: (text) => { try { return fn(text); } catch { return false; } } });
const EXPECTED = [["2.8", null], ["2.8.1", 86.4], ["4.1.8", 9.75], ["5.33", null], ["5.33.1", 24.6], ["5.22A", null], ["5.22A.6", 2850], ["6.1.2", 31.2], ["13.1.1", 412]];
CASES.push(
  {
    group: "tender", background: true, name: "Copies every tender BOQ line exactly: item numbers, headings, units and quantities",
    body: { task: "tender-items", message: "Copy the complete BOQ from the attached tender document.", attachments: [tenderPdf] },
    must: [
      check("all 9 lines with the right item numbers and quantities", (t) => JSON.stringify(Q.tenderItemsFromText(t).map((i) => [i.ref, i.heading ? null : i.qty])) === JSON.stringify(EXPECTED)),
      /including pumping of concrete to site of laying but excluding the cost of centering, shuttering, finishing and reinforcement/,
      /Thermo-Mechanically Treated bars of grade Fe-500D or more/
    ],
    mustNot: [/Total/, /Rate \(Rs/]
  },
  {
    group: "tender", background: true, name: "Suggests a sensible rate for every tender item",
    body: { task: "tender-rates", message: Q.rateRequests(Q.tenderItems([["Item No", "Description", "Unit", "Qty"], ["2.8", "Earth work in excavation by mechanical means in foundation trenches, lift upto 1.5 m, lead 50 m", "", ""], ["2.8.1", "All kinds of soil", "cum", 86.4], ["5.22A.6", "Steel reinforcement for R.C.C. work, Thermo-Mechanically Treated bars of grade Fe-500D, upto plinth level", "kg", 2850], ["13.1.1", "12 mm cement plaster of mix 1:6 (1 cement : 6 coarse sand)", "sqm", 412]]), { location: "Mysuru, Karnataka", currency: "INR", month: "November 2026" })[0].message },
    must: [check("3 rates in sensible ranges (earthwork 150–600/cum, steel 60–120/kg, plaster 200–600/sqm)", (t) => { const [a, b, c] = Q.ratesFromText(t, 3); return a >= 150 && a <= 600 && b >= 60 && b <= 120 && c >= 200 && c <= 600; })]
  }
);

const conditionsPdf = { name: "sample-tender-conditions.pdf", mimeType: "application/pdf", data: require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample-tender-conditions.pdf")).toString("base64") };
const TERMS = "**Work & time**\n- Complete in 6 months.\n- Offer must stay valid for 120 days from opening.\n**Money**\n- EMD Rs. 97,200.\n- Rates must include ALL taxes including GST; no separate GST is paid.\n- Monthly running bills; no advance.\n**Materials & quality**\n- Steel: Fe-500D TMT from SAIL, TATA or JSW only.";
const sampleItems = Q.tenderItems([["Item No", "Description", "Unit", "Qty"],
  ["4.1.8", "Providing and laying in position cement concrete 1:4:8 up to plinth level, excluding centering and shuttering", "cum", 9.75],
  ["5.33.1", "Machine batched M-25 RCC up to plinth level including pumping, excluding centering, shuttering, finishing and reinforcement", "cum", 24.6],
  ["5.22A.6", "Steel reinforcement Fe-500D TMT for R.C.C. work up to plinth level, straightening, cutting, bending, placing and binding", "kg", 2850],
  ["13.1.1", "12 mm cement plaster of mix 1:6", "sqm", 412]]).map((it) => ({ ...it, rate: { "4.1.8": 6200, "5.33.1": 7900, "5.22A.6": 32, "13.1.1": 330 }[it.ref] }));
CASES.push(
  {
    group: "tender", background: true, name: "Key tender terms in plain words, with the exact numbers",
    body: { task: "tender-terms", message: "List the important tender terms in plain words.", attachments: [conditionsPdf] },
    must: [/6 months|six months/i, /120 days/, /97,200/, /0\.5\s?%/, /10\s?%/, /GST/, /SAIL|TATA|JSW/, /advance/i]
  },
  {
    group: "tender", background: true, name: "Simplifies long tender specs and keeps what is included or excluded",
    body: { task: "tender-simplify", message: Q.simplifyRequests(sampleItems)[0].message },
    must: [check("4 short lines, each under 30 words", (t) => { const s = Q.shortsFromText(t, 4); return s.every((x) => x && x.split(/\s+/).length <= 30); }), /pump/i, /shutter|centering/i, /reinforcement|steel/i]
  },
  {
    group: "tender", background: true, name: "Check flags GST added against an all-inclusive tender, short validity, advance terms and a too-low steel rate",
    body: { task: "tender-check", message: Q.reviewMessage({ currency: "INR", taxLabel: "GST", taxRate: 18, date: "2026-11-24", validUntil: "2026-12-24", terms: "1. 50% advance with the order.", tenderTerms: TERMS, client: { site: "Mysuru, Karnataka" }, items: sampleItems }, []) },
    must: [/^🔴/m, /GST/, /120/, /advance/i, /5\.22A\.6|steel/i]
  }
);

const myBook = Q.addToRateBook([], { currency: "INR", items: [
  { description: "Machine batched M-25 RCC up to plinth level including pumping, excluding centering, shuttering and reinforcement", unit: "cum", qty: 1, rate: 7900 },
  { description: "12 mm cement plaster of mix 1:6 on brick walls", unit: "sqm", qty: 1, rate: 265 }] }).book;
const myRatesMessage = Q.rateRequests([
  { ref: "5.33.1", description: "Machine batched machine mixed M-25 grade RCC, all works up to plinth level, including pumping, excluding centering, shuttering, finishing and reinforcement", unit: "cum", qty: 24.6, rate: 0 },
  { ref: "5.33.2", description: "Machine batched M-30 grade RCC in suspended slabs and beams from plinth to floor five level, including pumping, excluding centering, shuttering and reinforcement", unit: "cum", qty: 40, rate: 0 },
  { ref: "13.1.1", description: "12 mm cement plaster of mix 1:6 (1 cement : 6 coarse sand)", unit: "sqm", qty: 412, rate: 0 }
], { location: "Mysuru, Karnataka", currency: "INR", month: "November 2026", book: myBook })[0].message;
CASES.push({
  group: "tender", background: true, name: "Uses my own rates first: same work as is, different grade adjusted",
  body: { task: "tender-rates", message: myRatesMessage },
  must: [check("5.33.1 = my 7900 (R1); 5.33.2 = R1 adjusted upward; plaster = my 265 (R2)", (t) => {
    const r = Q.ratesFromText(t, 3), src = Q.sourcesFromText(t, 3);
    return r[0] === 7900 && /^R1$/i.test(src[0]) && /^R1/i.test(src[1]) && /adjust/i.test(src[1]) && r[1] > 7900 && r[2] === 265 && /^R2$/i.test(src[2]);
  })]
});

// ---------- consultant tools (group "consultant"): bids, bills, drawings, specifications ----------
const CONS = require("../assets/consult.js");
const fixture = (file, mimeType) => ({ name: file, mimeType, data: require("fs").readFileSync(require("path").join(__dirname, "fixtures", file)).toString("base64") });
CASES.push(
  {
    group: "consultant", background: true, name: "Copies a priced bid exactly, keeping the bidder's arithmetic error",
    body: { task: "priced-boq", message: "Copy the complete priced BOQ from the attached bid.", attachments: [fixture("sample-priced-bid.pdf", "application/pdf")] },
    must: [check("5 items with rates 310, 6150, 7850, 78.5, 285 and item 3's amount as printed (139110)", (t) => {
      const it = Q.pricedItems(CONS.tableRows(t)).filter((x) => !x.heading);
      return it.length === 5 && JSON.stringify(it.map((x) => x.rate)) === "[310,6150,7850,78.5,285]" && it[2].amount === 139110;
    })],
    mustNot: [/193,?110/]
  },
  {
    group: "consultant", background: true, name: "Copies an RA bill with previous and up-to-date quantities",
    body: { task: "bill-items", message: "Copy the complete running bill from the attached document.", attachments: [fixture("sample-ra-bill.pdf", "application/pdf")] },
    must: [check("3 items: up to date 86.4 / 22.5 / 2250, previous 86.4 / 10 / 900", (t) => {
      const it = CONS.billItems(CONS.tableRows(t)).filter((x) => !x.heading);
      return it.length === 3 && JSON.stringify(it.map((x) => [x.qty, x.prev])) === "[[86.4,86.4],[22.5,10],[2250,900]]";
    })]
  },
  {
    group: "consultant", background: true, name: "Reads beams and columns with their bars from a schedule drawing",
    body: { task: "bbs-members", message: "List the members and reinforcement shown in the attached structural drawing.", attachments: [fixture("sample-member-schedule.png", "image/png")] },
    must: [check("B1, B2 and C1 read with sizes, counts and bars (B2 bottom 2-20 + 1-16)", (t) => {
      const m = Object.fromEntries(CONS.membersFromText(t).map((x) => [x.mark, x]));
      const b1 = m.B1, b2 = m.B2, c1 = m.C1;
      return b1 && b2 && c1 && b1.count === 4 && b1.length === 4000 && b1.width === 230 && b1.depth === 450 && b1.bottom.n === 3 && b1.bottom.dia === 16 && b1.stirrup.dia === 8 && b1.stirrup.spacing === 150
        && b2.depth === 600 && b2.bottom.n === 3 && JSON.stringify(b2.bottom.parts.map((p) => p.dia).sort()) === "[16,20]" && b2.stirrup.spacing === 125
        && c1.count === 6 && c1.height === 3200 && c1.main.n === 4 && c1.tie.spacing === 150;
    })]
  },
  {
    group: "consultant", background: true, name: "Writes technical specifications by trade with codes, testing and measurement",
    body: { task: "spec-items", message: CONS.specMessage({ name: "Anganwadi building", location: "Mysuru, Karnataka, India" }, sampleItems) },
    must: [/Draft for the consultant's review/, /IS\s?456/, /IS\s?1786|Fe[\s-]?500D/, /cube|compressive strength/i, /Mode of measurement/i, /slump/i, /\[confirm\]|approved make/i]
  },
  {
    group: "consultant", background: true, name: "Drafts tender conditions with NIT, LD cap, DLP and approved makes",
    body: { task: "spec-conditions", message: CONS.conditionsMessage({ name: "Anganwadi building", location: "Mysuru, Karnataka, India", cost: "Rs. 48 lakh", period: "6 months" }, sampleItems) },
    must: [/Notice inviting tender/i, /48 lakh|48,00,000/, /6 months|six months/i, /liquidated damages/i, /defects? liability/i, /approved makes?/i, /\[confirm\]/, /arbitration/i]
  }
);

const snagSample = [
  { defect: "Honeycombing near the base of the column, about 120 × 90 mm", remedy: "Chip loose concrete to sound surface, apply bonding agent and polymer-modified repair mortar; cure for 7 days; verify depth on site" },
  { defect: "No edge protection at open slab edge; worker standing near the edge", remedy: "Stop work at the edge now; install a guard rail 1 m high with a toe board before work resumes" },
  { defect: "Cover blocks missing under bottom bars of beam B2", remedy: "Place 25 mm cover blocks at 1 m spacing before concreting; check cover" }
];
for (const [code, re, name] of [["hi", /[\u0900-\u097F]/, "Hindi"], ["kn", /[\u0C80-\u0CFF]/, "Kannada"]]) {
  CASES.push({
    group: "consultant", background: true, name: `Snag defects and remedies in ${name}, numbers and safety steps kept`,
    body: { task: "snag-translate", message: CONS.translateMessage(snagSample, code) },
    must: [check(`3 rows in ${name} script, each with defect and remedy`, (t) => { const r = CONS.translationsFromText(t, 3); return r.every((x) => x && re.test(x.defect) && re.test(x.remedy)); }),
      /120 × 90|120 x 90/, /\b7\b/, /1 m\b|1m\b/, /25 mm|25mm/]
  });
}

const longTender = { name: "sample-tender-boq-long.pdf", mimeType: "application/pdf", data: require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample-tender-boq-long.pdf")).toString("base64") };
const LONG_EXPECTED = JSON.parse(require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample-tender-boq-long.json"), "utf8"));
CASES.push({
  group: "tender", background: true, name: "Copies a 3-page, 61-line tender BOQ exactly (item numbers, headings, quantities)",
  body: { task: "tender-items", message: "Copy the complete BOQ from the attached tender document.", attachments: [longTender] },
  must: [
    check("all 61 lines: same item numbers, headings and quantities in order", (t) => {
      const got = Q.tenderItemsFromText(t).map((i) => [i.ref, i.heading ? null : i.qty]);
      const ok = JSON.stringify(got) === JSON.stringify(LONG_EXPECTED);
      if (!ok) console.log("    mismatch:", JSON.stringify(got.filter((g, k) => JSON.stringify(g) !== JSON.stringify(LONG_EXPECTED[k])).slice(0, 5)), "got", got.length, "lines");
      return ok;
    }),
    /including admixtures in recommended proportions as per IS : 9103 to accelerate, retard setting of concrete, improve workability without impairing strength and durability/,
    /with extruded built up standard tubular sections\/ ?appropriate Z sections/
  ]
});
const priceListPdf = { name: "sample-price-list.pdf", mimeType: "application/pdf", data: require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample-price-list.pdf")).toString("base64") };
const sampleMaterials = Q.addMaterials([], Q.materialsFromText("Supplier: Sri Ganesh Building Materials\nList date: 2026-11-01\n\n| Item | Make | Size / Model | Unit | Price | Price basis |\n|---|---|---|---|---|---|\n| OPC 43 grade cement | UltraTech | 50 kg bag | Bag | 385 | dealer excl GST |\n| River sand, washed | | Zone II | Cum | 2850 | dealer excl GST |\n| TMT bar Fe-500D | TATA Tiscon | 12 mm | Kg | 68.75 | dealer excl GST |").list, "2026-11-24").materials;
CASES.push(
  {
    group: "tender", background: true, name: "Copies a supplier price list: supplier, date, makes, sizes, units and dealer prices",
    body: { task: "price-list", message: "Copy this price list.", attachments: [priceListPdf] },
    must: [
      check("supplier and date 2026-11-01", (t) => { const r = Q.materialsFromText(t); return /Ganesh/i.test(r.supplier) && r.listDate === "2026-11-01"; }),
      check("cement 385, 12 mm TMT 68.75, sand 2850, putty 1050 (MRP), 7 rows", (t) => { const l = Q.materialsFromText(t).list; const p = (re) => (l.find((m) => re.test(Q.matLabel(m))) || {}).price; return l.length === 7 && p(/UltraTech/) === 385 && p(/12 mm/) === 68.75 && p(/sand/i) === 2850 && p(/putty/i) === 1050; }),
      /excl/i
    ]
  },
  {
    group: "tender", background: true, name: "Builds rates from my material prices and shows the breakup",
    body: { task: "tender-rates", message: Q.rateRequests([
      { ref: "13.1.1", description: "12 mm cement plaster of mix 1:6 (1 cement : 6 coarse sand) on brick walls", unit: "sqm", qty: 412, rate: 0 },
      { ref: "5.22A.6", description: "Steel reinforcement for R.C.C. work including straightening, cutting, bending, placing in position and binding, Thermo-Mechanically Treated bars of grade Fe-500D", unit: "kg", qty: 2850, rate: 0 }
    ], { location: "Mysuru, Karnataka", currency: "INR", month: "November 2026", materials: sampleMaterials })[0].message },
    must: [check("both built from M ids, with a breakup; plaster 180–450/sqm, steel 75–110/kg", (t) => {
      const r = Q.ratesFromText(t, 2), src = Q.sourcesFromText(t, 2), b = Q.basisFromText(t, 2);
      return /M\d/.test(src[0]) && /M\d/.test(src[1]) && /385|380/.test(b[0] || "") && /68\.75|68/.test(b[1] || "") && r[0] >= 180 && r[0] <= 450 && r[1] >= 75 && r[1] <= 110;
    })]
  }
);

// ---------- several files at once (group "multi") ----------
CASES.push(
  {
    group: "multi", name: "A drawing and a product photo in one question: both are read and named",
    body: { message: "Using the drawing and the product photo: how much concrete does this slab need, and can I use this waterbar at its construction joint?", attachments: [drawing, photo("product-waterbar.jpg")], audience: "engineer" },
    must: [/2\.0[0-9]?\s*m(³|3)|2\.025/, /water ?bar|water ?stop/i, /S-101|sample-slab-drawing|drawing/i, /photo|label|product-waterbar/i]
  },
  {
    group: "multi", background: true, name: "Full BOQ from an attached drawing (background job)",
    body: { message: "Prepare the BOQ with rates for this slab", attachments: [drawing], audience: "engineer", quoteReady: true },
    must: [ROWS(3), /M30/, /T10|reinforcement|steel/i, /shuttering|formwork/i, /Grand Total/i]
  }
);
CASES.push(
  {
    group: "product", name: "Expired waterbar: notices the use-by date and says not to use it",
    body: { message: "Can I use this waterbar strip for our basement pour next week?", attachment: photo("product-waterbar.jpg"), audience: "worker" },
    must: [/(expir|03\/2025|use by|use-by)/i, /(do not|don't|not)[^.\n]{0,80}(use|install)|replace|fresh|new (stock|batch|roll)/i]
  },
  {
    group: "product", name: "Epoxy at 2 °C: follows the label's +8 °C minimum and PPE",
    body: { message: "Can I inject cracks with this tonight? It is 2 °C outside.", attachment: photo("product-epoxy.jpg"), audience: "worker" },
    must: [/\+?\s?8\s*°\s*C/, /(no|not|don't|do not|cannot|can't)/i, /(glove|H317|skin)/i]
  },
  {
    group: "product", name: "Non-construction product (honey): stays in scope",
    body: { message: "How should I use this?", attachment: photo("product-honey.jpg"), audience: "worker" },
    must: [/(construction|site)/i],
    mustNot: [/(teaspoon|tablespoon|recipe|tea\b|toast|sweeten)/i]
  },
  {
    group: "product", name: "Blurry cement bag: admits it cannot read the label instead of guessing",
    body: { message: "What grade and standard is this cement, and what is the batch number?", attachment: photo("product-blurry-cement.jpg"), audience: "engineer" },
    must: [/(not (clearly )?(legible|readable|visible)|illegible|can(no|')t (clearly )?(read|make out|confirm)|blurr|unclear|clearer photo|retake)/i]
  }
);

// ---------- answer language (group "language"): reply must be in the script of the question or the chosen language ----------
const words = (range, n) => new RegExp(`([${range}]+[\\s,.?!:;()-]+){${n},}`);
CASES.push(
  { group: "language", name: "Hindi (Devanagari) question, Auto → Hindi answer", body: { message: "100 वर्ग फुट प्लास्टर के लिए कितना सीमेंट और रेत लगेगा?", language: "auto", audience: "worker" }, must: [words("\\u0900-\\u097F", 15)] },
  { group: "language", name: "Hinglish question, Auto → Hinglish (Latin) answer", body: { message: "slab ki curing kitne din karni chahiye?", language: "auto", audience: "worker" }, must: [/\b(din|karein|karna|chahiye|hai|paani|ke)\b/i], mustNot: [words("\\u0900-\\u097F", 8)] },
  { group: "language", name: "Urdu question, Auto → Urdu answer", body: { message: "سلیب کی کیورنگ کتنے دن کرنی چاہیے؟", language: "auto", audience: "worker" }, must: [words("\\u0600-\\u06FF", 12)] },
  { group: "language", name: "Tamil question, Auto → Tamil answer", body: { message: "ஸ்லாப் கியூரிங் எத்தனை நாட்கள் செய்ய வேண்டும்?", language: "auto", audience: "worker" }, must: [words("\\u0B80-\\u0BFF", 10)] },
  { group: "language", name: "Bengali question, Auto → Bengali answer", body: { message: "ছাদ ঢালাইয়ের পর কত দিন কিউরিং করতে হবে?", language: "auto", audience: "worker" }, must: [words("\\u0980-\\u09FF", 10)] },
  { group: "language", name: "English question, Malayalam chosen → Malayalam answer", body: { message: "How many days should I cure a concrete slab?", language: "ml", audience: "worker" }, must: [words("\\u0D00-\\u0D7F", 10)] },
  { group: "language", name: "English question, Arabic chosen → Arabic answer", body: { message: "What is the minimum cover for a footing?", language: "ar", audience: "engineer" }, must: [words("\\u0600-\\u06FF", 15)] }
);

const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const group = argValue("--group");
const reportPath = argValue("--report");
const printAll = args.includes("--print-all");
const selected = group ? CASES.filter((c) => c.group === group) : CASES;

(async () => {
  let failed = 0;
  const report = [`# Answer check${group ? ` — ${group}` : ""}`, "", `Model: ${require("../netlify/functions/chat").MODEL} · ${new Date().toISOString()}`, ""];
  for (const c of selected) {
    const event = { httpMethod: "POST", headers: { host: "localhost" }, body: JSON.stringify(c.body) };
    const res = c.background ? await run(event, { background: true }) : await handler(event);
    const reply = JSON.parse(res.body).reply || JSON.parse(res.body).error || "";
    const problems = [];
    if (res.statusCode !== 200) problems.push(`HTTP ${res.statusCode}`);
    (c.must || []).forEach((re) => { if (!re.test(reply)) problems.push(`missing ${re}`); });
    (c.mustNot || []).forEach((re) => { if (re.test(reply)) problems.push(`should not contain ${re}`); });
    if (problems.length) { failed += 1; console.log(`✗ ${c.name}\n    ${problems.join("\n    ")}\n    --- reply ---\n${reply.split("\n").map((l) => "    " + l).join("\n")}\n`); }
    else console.log(`✓ ${c.name}${printAll ? `\n    --- reply ---\n${reply.split("\n").map((l) => "    " + l).join("\n")}\n` : ""}`);
    report.push(`## ${problems.length ? "✗" : "✓"} ${c.name}`, "", `**Question:** ${c.body.message} _(style: ${c.body.audience || "engineer"})_`, "");
    if (problems.length) report.push(`**Missing:** ${problems.join("; ")}`, "");
    report.push(reply, "", "---", "");
  }
  console.log(`\n${selected.length - failed}/${selected.length} passed`);
  if (reportPath) { require("fs").writeFileSync(reportPath, report.join("\n")); console.log(`Full answers written to ${reportPath}`); }
  process.exit(failed ? 1 : 0);
})();
