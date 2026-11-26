"use strict";
// Builds the trade pages for/<slug>.html (and for/index.html) from netlify/functions/trades.js.
// Each page: what this app does for that trade, one-tap questions (they open the Ask AI page with the
// question filled in and the trade remembered), the trade's calculators and tools, and its own WhatsApp
// link ("Hi! I am a plumber 🔧", which the bot answers with a welcome for that trade).
// Run: node scripts/build-trade-pages.js   (the test checks the committed pages are up to date)
const fs = require("fs");
const path = require("path");
const { TRADES, waText } = require("../netlify/functions/trades");

const SITE = "https://civilengineervijay.netlify.app";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CALCS = {
  concrete: ["🏗️", "Concrete volume", "Cement, sand and aggregate for slabs, beams, columns and footings"],
  plaster: ["🪣", "Plaster", "Cement and sand for wall and ceiling plaster"],
  paint: ["🎨", "Paint litres", "Paint for a room's walls and ceiling, by coats"],
  tiles: ["🔲", "Tiles & adhesive", "Tiles, boxes and adhesive for a floor or wall"],
  steel: ["🔩", "Steel weight & stirrup length", "Bar weight (d²/162) and stirrup cutting length"],
  brickwork: ["🧱", "Brickwork", "Bricks, cement and sand for a wall"],
  blocks: ["🧊", "Blockwork", "Concrete blocks for a wall"],
  ac: ["❄️", "AC tonnage", "Quick split-AC size for a room"],
  water: ["🚰", "Water tank size", "Domestic water storage for a building"]
};
const TOOLS = {
  quotation: ["/quotation", "🧾", "Quotation maker", "Turn a BOQ or tender into a quotation PDF with GST/VAT; send it on WhatsApp."],
  tender: ["/quotation", "📄", "Tender → quotation", "Import a tender BOQ (Excel, PDF or photos), get rates, and fill the client's own format."],
  mywork: ["/my-work", "📊", "My work", "Your quotations, bids due, won jobs and running bills in one place."],
  snags: ["/consultant#snags", "📷", "Snag list from photos", "Photos in, defects with severity and remedy out — in English plus Hindi, Kannada and more."],
  bids: ["/consultant#bids", "📊", "Bid comparison", "Comparative statement of contractors' bids with rates flagged against the median."],
  bbs: ["/consultant#bbs", "🔩", "Bar bending schedule", "Cutting lengths and weights from member sizes, or read from a drawing."],
  checks: ["/consultant#checks", "📐", "IS 456 check sheets", "Preliminary slab, beam, column and footing checks with clauses."],
  specs: ["/consultant#specs", "📝", "Specs & tender writer", "Technical specifications and tender conditions from a BOQ."],
  bills: ["/consultant#bills", "✅", "Bill certification", "Check a running bill against the agreement and MB quantities."]
};

// What each trade gets: one-tap questions, calculators and tools.
const CONTENT = {
  plumber: { lead: "Pipe sizes, slopes, pressure tests, water tanks and leak repairs — ask in your own language, or send a photo of the problem.",
    seo: "pipe sizes, drainage slope, pressure test, water tank", calcs: ["water"], tools: ["quotation"],
    questions: ["What pipe sizes do I need for the water supply of a 4-flat building?", "What slope should a 110 mm drainage pipe have?", "How do I pressure test PPR pipes, and for how long?", "CPVC or PPR for hot water lines — which is better?", "A concealed pipe joint is leaking behind tiles — how do I find and fix it?", "What size water tank for a family of 6?"] },
  electrician: { lead: "Cable sizes, MCB and RCCB ratings, earthing, points and tripping problems — with safe steps first.",
    seo: "cable size, MCB rating, earthing, RCCB tripping", calcs: ["ac"], tools: ["quotation"],
    questions: ["What cable size and MCB do I need for a 1.5 ton AC?", "Cable size for a 3 kW water heater (geyser)?", "Earth pit resistance — what value is acceptable?", "The RCCB keeps tripping — what should I check first, safely?", "How many light points can go on one 1.5 sq mm circuit?", "What conduit size for 4 wires of 2.5 sq mm?"] },
  mason: { lead: "Cement, sand and bricks for walls and plaster, mortar mixes, curing and cracks — worked out step by step.",
    seo: "plaster cement and sand, bricks per wall, mortar ratio", calcs: ["plaster", "brickwork", "blocks", "concrete"], tools: ["quotation"],
    questions: ["How much cement and sand for 100 sq ft of 12 mm wall plaster?", "How many bricks for a 10 × 10 ft wall, 9 inches thick?", "What mortar mix for brickwork, 1:4 or 1:6?", "Why does new plaster crack, and how do I stop it?", "How many days should I cure a block wall?", "How many concrete blocks for a 3 m high, 10 m long wall?"] },
  painter: { lead: "Paint quantities, primer and putty steps, drying times, and why paint peels or blisters.",
    seo: "paint quantity, putty and primer, peeling paint", calcs: ["paint", "plaster"], tools: ["quotation"],
    questions: ["How much paint for a 12 × 10 ft room with 10 ft height, 2 coats?", "How long must new plaster dry before painting?", "Steps for interior painting: putty, primer and emulsion", "Paint is peeling on an outside wall — why, and how to repair it?", "Coverage of exterior emulsion per litre?", "How to treat damp patches before painting?"] },
  tiler: { lead: "Tiles and boxes, adhesive or cement mortar, joint widths, slopes and hollow tiles.",
    seo: "tiles per area, tile adhesive, hollow tiles", calcs: ["tiles"], tools: ["quotation"],
    questions: ["How many boxes of 2 × 2 ft tiles for a 200 sq ft floor?", "Tile adhesive or cement mortar — which should I use?", "Tiles sound hollow after fixing — how do I fix it?", "What slope for a bathroom floor to the drain?", "What joint width for vitrified tiles?", "How to fix large wall tiles safely?"] },
  carpenter: { lead: "Shuttering and props, removal times, plywood reuse, and door and window frames.",
    seo: "shuttering removal time, prop spacing, plywood reuse", calcs: ["concrete"], tools: ["quotation"],
    questions: ["When can I remove slab shuttering and props?", "What prop spacing under a 150 mm thick slab?", "How many times can shuttering plywood be reused?", "Which release oil for shuttering plates?", "How to fix a door frame in a brick wall?", "Shuttering for a 230 × 450 mm beam — what to check before concreting?"] },
  "bar-bender": { lead: "Cutting lengths, bend deductions, laps, cover and bar weights — and a full bar bending schedule.",
    seo: "stirrup cutting length, lap length, bar weight, BBS", calcs: ["steel"], tools: ["bbs"],
    questions: ["Cutting length of an 8 mm stirrup for a 230 × 450 mm beam with 25 mm cover", "Lap length for 16 mm bars in a column", "Bend deduction for 90° and 135° bends", "Weight of one 12 m length of 12 mm bar", "What cover for slab, beam, column and footing bars?", "How to make a bar bending schedule for a beam?"] },
  waterproofing: { lead: "Terraces, bathrooms, basements and water tanks: which system, the steps, and how to test it.",
    seo: "terrace waterproofing, bathroom waterproofing, ponding test", calcs: [], tools: ["quotation"],
    questions: ["Best waterproofing for an old leaking terrace", "Bathroom waterproofing before tiles — the steps", "How long should a ponding test be?", "How to stop basement wall leakage from inside?", "Waterproofing for an underground water tank", "How to treat a crack in the roof slab before waterproofing?"] },
  "ac-technician": { lead: "AC tonnage, copper pipe sizes, drain slopes, vacuuming and gas charging.",
    seo: "AC tonnage, copper pipe size, drain slope", calcs: ["ac"], tools: ["quotation"],
    questions: ["What AC tonnage for a 12 × 14 ft bedroom in a hot climate?", "Copper pipe sizes for a 1.5 ton split AC", "Drain pipe slope for an indoor unit", "How long to vacuum before charging gas?", "Maximum pipe length between indoor and outdoor units", "AC is not cooling — what should I check first?"] },
  "site-engineer": { lead: "Concrete, cubes and slump, curing and deshuttering, quality checks, quantities and site problems — with the working shown.",
    seo: "concrete cube tests, slump, curing, deshuttering, QA/QC", calcs: ["concrete", "steel", "plaster", "brickwork"], tools: ["snags", "bbs", "checks"],
    questions: ["How many cube samples for 30 m³ of M25 concrete?", "What slump for pumped concrete?", "Deshuttering times for slabs, beams and columns", "Checklist before a slab pour", "M25 mix design for a residential slab", "Cracks appeared in a slab 2 days after casting — what to do?"] },
  contractor: { lead: "BOQs, rate analysis, tenders, quotations, running bills and your own rates — from a tender to a quotation in minutes.",
    seo: "BOQ, rate analysis, tender quotation, running bills", calcs: ["concrete", "plaster", "brickwork", "paint", "tiles"], tools: ["tender", "quotation", "mywork"],
    questions: ["BOQ for a 1,000 sq ft G+1 house", "Rate analysis for 12 mm cement plaster 1:6", "How to price a government tender item from CPWD DSR?", "Deductions in a running-account bill (retention, TDS, cess)", "Preliminary cost of a 30 × 40 ft house in Bengaluru", "Checklist before submitting a tender"] },
  consultant: { lead: "Snag lists from site photos, bid comparison, bar bending schedules, IS 456 checks, specifications and bill certification.",
    seo: "snag list, comparative statement, BBS, IS 456 checks, specifications", calcs: ["concrete", "steel"], tools: ["snags", "bids", "bbs", "checks", "specs", "bills"],
    questions: ["IS 456 span/depth check for a 4.5 m simply supported slab", "Minimum steel and spacing rules for a beam", "Typical specification for M25 RCC in slabs", "What to check before certifying a running bill?", "How to evaluate an abnormally low bid?", "Defects liability period and retention — usual practice"] }
};

const NAV = `<nav class="bg-white border-b border-slate-200"><div class="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3"><a href="/" class="flex min-w-0 items-center gap-2 font-bold leading-tight text-slate-800"><img src="/assets/logo.svg" alt="" width="32" height="32" class="w-8 h-8"><span class="truncate">Construction AI Expert</span></a><div class="flex items-center gap-4 text-sm font-medium text-blue-700"><a href="/expert" class="whitespace-nowrap hover:text-blue-900">Ask AI</a><a href="/calculators" class="whitespace-nowrap hover:text-blue-900">Calculators</a><a href="/for/" class="whitespace-nowrap hover:text-blue-900">Your work</a></div></div></nav>`;
const FOOTER = `<footer class="border-t border-slate-200 bg-white"><p class="max-w-5xl mx-auto px-4 py-6 text-sm leading-relaxed text-slate-500">AI answers are general guidance — check them with the responsible engineer before use. <a href="/disclaimer" class="text-blue-700 hover:underline">Disclaimer &amp; terms</a> · <a href="/privacy" class="text-blue-700 hover:underline">Privacy notice</a></p></footer>`;
const head = ({ title, description, canonical }) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}${canonical}">
  <meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${SITE}${canonical}"><meta property="og:image" content="${SITE}/assets/logo-512.png">
  <meta name="theme-color" content="#1e3a8a">
  <link rel="icon" href="/assets/logo.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="stylesheet" href="/assets/site.css">
  <script src="/assets/site-config.js"></script>
  <script src="/assets/growth.js" defer></script><script src="/assets/app.js" defer></script>
</head>
<body class="bg-slate-100 text-slate-900 font-sans">
${NAV}`;

function tradePage(t) {
  const c = CONTENT[t.slug];
  const ask = (q) => `/expert?trade=${t.slug}&audience=${t.audience}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const title = `${t.plural}: ${c.seo} — free AI help | Construction AI Expert`;
  const description = `Free construction AI for ${t.plural.toLowerCase()}: ${c.lead} Calculators, tools and WhatsApp help in English, हिन्दी, ಕನ್ನಡ, தமிழ் and more.`;
  const calcs = c.calcs.map((id) => { const [icon, name, desc] = CALCS[id]; return `<a href="/calculators#${id}" class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-400"><p class="font-bold text-blue-800">${icon} ${esc(name)}</p><p class="mt-1 text-sm text-slate-600">${esc(desc)}</p></a>`; }).join("\n        ");
  const tools = c.tools.map((id) => { const [href, icon, name, desc] = TOOLS[id]; return `<a href="${href}" class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-400"><p class="font-bold text-blue-800">${icon} ${esc(name)}</p><p class="mt-1 text-sm text-slate-600">${esc(desc)}</p></a>`; }).join("\n        ");
  return `${head({ title, description, canonical: `/for/${t.slug}` })}
  <main class="max-w-4xl mx-auto px-3 sm:px-4 py-6">
    <section class="rounded-2xl bg-blue-900 p-5 sm:p-7 text-white shadow-sm">
      <p class="text-4xl" aria-hidden="true">${t.emoji}</p>
      <h1 class="mt-2 text-2xl sm:text-3xl font-extrabold">For ${esc(t.plural.toLowerCase())}</h1>
      <p class="mt-2 text-blue-100">${esc(c.lead)}</p>
      <p class="mt-2 text-sm text-white" lang="mul">English · हिंदी · ಕನ್ನಡ · தமிழ் · తెలుగు · മലയാളം · मराठी · বাংলা · ਪੰਜਾਬੀ · اردو · العربية</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <a href="${ask("")}" class="rounded-full bg-amber-400 px-5 py-2.5 font-bold text-slate-900 hover:bg-amber-300">💬 Ask the AI</a>
        <a data-wa-bot data-wa-text="${esc(waText(t))}" class="hidden rounded-full bg-green-500 px-5 py-2.5 font-bold text-white hover:bg-green-600">🟢 Ask on WhatsApp</a>
        <button type="button" data-share-app class="rounded-full bg-white/15 px-5 py-2.5 font-bold text-white ring-1 ring-white/40 hover:bg-white/25">📤 Share with a friend</button>
      </div>
    </section>

    <section class="mt-5">
      <h2 class="text-lg font-bold text-slate-800">Ask in one tap</h2>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        ${c.questions.map((q) => `<a href="${ask(q)}" class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-800 shadow-sm hover:border-blue-400">${esc(q)} →</a>`).join("\n        ")}
      </div>
      <p class="mt-2 text-xs text-slate-500">Type or 🎤 speak in your own language, or 📷 send a photo of the problem.</p>
    </section>
${calcs ? `
    <section class="mt-6">
      <h2 class="text-lg font-bold text-slate-800">Your calculators</h2>
      <div class="mt-2 grid gap-3 sm:grid-cols-2">
        ${calcs}
      </div>
    </section>
` : ""}
    <section class="mt-6">
      <h2 class="text-lg font-bold text-slate-800">Your tools</h2>
      <div class="mt-2 grid gap-3 sm:grid-cols-2">
        ${tools}
      </div>
    </section>

    <p class="mt-6 text-sm text-slate-600">Other work: ${TRADES.filter((x) => x.slug !== t.slug).map((x) => `<a href="/for/${x.slug}" class="text-blue-700 hover:underline">${x.emoji} ${esc(x.plural)}</a>`).join(" · ")}</p>
  </main>
${FOOTER}
</body>
</html>
`;
}

function indexPage() {
  const title = "Choose your work — free construction AI for every trade | Construction AI Expert";
  const description = "Plumbers, electricians, masons, painters, tile fixers, carpenters, bar benders, waterproofing, AC technicians, site engineers, contractors and consultants: your own questions, calculators and tools.";
  return `${head({ title, description, canonical: "/for/" })}
  <main class="max-w-4xl mx-auto px-3 sm:px-4 py-6">
    <h1 class="text-2xl font-extrabold text-blue-900">Choose your work</h1>
    <p class="mt-1 text-slate-600">Your own questions, calculators and tools — in your language. Share your trade's page in your WhatsApp groups.</p>
    <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
      ${TRADES.map((t) => `<a href="/for/${t.slug}" class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-400"><p class="text-3xl" aria-hidden="true">${t.emoji}</p><p class="mt-1 font-bold text-blue-800">${esc(t.plural)}</p></a>`).join("\n      ")}
    </div>
  </main>
${FOOTER}
</body>
</html>
`;
}

function build(outDir = path.join(__dirname, "..", "for")) {
  const files = { "index.html": indexPage() };
  for (const t of TRADES) {
    if (!CONTENT[t.slug]) throw new Error(`No page content for ${t.slug}`);
    files[`${t.slug}.html`] = tradePage(t);
  }
  return files;
}

if (require.main === module) {
  const dir = path.join(__dirname, "..", "for");
  fs.mkdirSync(dir, { recursive: true });
  const files = build();
  for (const [name, html] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), html);
  console.log(`wrote ${Object.keys(files).length} pages in for/`);
}

module.exports = { build, CONTENT, CALCS, TOOLS };
