"use strict";
// The trades and roles with their own page (/for/<slug>) and WhatsApp link ("Hi! I am a plumber 🔧").
// Used by the page builder (scripts/build-trade-pages.js), the AI (chat.js: answers pitched at that
// trade) and the WhatsApp bot (whatsapp.js: recognises the link's first message and welcomes the trade).
const TRADES = [
  { slug: "plumber", short: "plumber", emoji: "🔧", name: "plumber", plural: "Plumbers", audience: "worker", detect: /\bplumb/,
    examples: ["Pipe sizes for a 4-flat building water supply", "Slope for a 110 mm drainage pipe", "How to pressure test PPR pipes"] },
  { slug: "electrician", short: "electrician", emoji: "⚡", name: "electrician", plural: "Electricians", audience: "worker", detect: /\belectric/,
    examples: ["Cable size and MCB for a 1.5 ton AC", "Earth pit resistance — what value is OK?", "RCCB keeps tripping — what to check first?"] },
  { slug: "mason", short: "mason", emoji: "🧱", name: "mason", plural: "Masons", audience: "worker", detect: /\bmason|brick ?lay|block ?work/,
    examples: ["Cement and sand for 100 sq ft of 12 mm plaster", "Bricks for a 10 × 10 ft 9-inch wall", "Why does new plaster crack?"] },
  { slug: "painter", short: "painter", emoji: "🎨", name: "painter", plural: "Painters", audience: "worker", detect: /\bpaint/,
    examples: ["Paint for a 12 × 10 ft room, 2 coats", "How long to wait before painting new plaster?", "Paint peeling on the outside wall — why?"] },
  { slug: "tiler", short: "tile fixer", emoji: "🔲", name: "tile fixer", plural: "Tile fixers", audience: "worker", detect: /\btil(e|er|ing)\b|\btile fix/,
    examples: ["Boxes of 2 × 2 ft tiles for a 200 sq ft floor", "Tile adhesive or cement mortar?", "Tiles sound hollow — how to fix?"] },
  { slug: "carpenter", short: "carpenter", emoji: "🪵", name: "carpenter / shuttering carpenter", plural: "Carpenters and shuttering", audience: "worker", detect: /\bcarpent|\bshutter/,
    examples: ["When can I remove slab shuttering and props?", "Prop spacing under a 150 mm slab", "Plywood shuttering — how many reuses?"] },
  { slug: "bar-bender", short: "bar bender", emoji: "🔩", name: "bar bender / steel fixer", plural: "Bar benders and steel fixers", audience: "worker", detect: /\bbar ?bend|\bsteel ?fix|\brebar|\bfitter/,
    examples: ["Cutting length of an 8 mm stirrup for a 230 × 450 beam", "Lap length for 16 mm bars in a column", "Weight of one 12 mm bar"] },
  { slug: "waterproofing", short: "waterproofing applicator", emoji: "💧", name: "waterproofing applicator", plural: "Waterproofing applicators", audience: "worker", detect: /\bwater ?proof/,
    examples: ["Best terrace waterproofing for an old roof", "Bathroom waterproofing before tiles — steps", "How long is a ponding test?"] },
  { slug: "ac-technician", short: "AC technician", emoji: "❄️", name: "AC / HVAC technician", plural: "AC and HVAC technicians", audience: "worker", detect: /\bhvac\b|\bac tech|\bair ?condition|\bac\b/,
    examples: ["AC tonnage for a 12 × 14 ft bedroom", "Copper pipe size for a 1.5 ton split AC", "Drain pipe slope for an indoor unit"] },
  { slug: "site-engineer", short: "site engineer", emoji: "👷", name: "site engineer / supervisor", plural: "Site engineers and supervisors", audience: "engineer", detect: /\bsite engineer|\bsupervisor|\bforeman|\bsite in.?charge/,
    examples: ["How many cubes for 30 m³ of M25 concrete?", "Slump for pumped concrete", "Deshuttering times for slabs and beams"] },
  { slug: "contractor", short: "contractor", emoji: "🏗️", name: "contractor / builder", plural: "Contractors and builders", audience: "engineer", detect: /\bcontractor|\bbuilder/,
    examples: ["BOQ for a 1,000 sq ft G+1 house", "Rate analysis for 12 mm cement plaster", "Deductions in a running-account bill"] },
  { slug: "consultant", short: "consultant", emoji: "📐", name: "consultant (architect / structural engineer / PMC)", plural: "Consultants, architects and PMCs", audience: "engineer", detect: /\bconsultant|\barchitect|\bstructural|\bpmc\b|\bquantity surveyor|\bqs\b/,
    examples: ["Snag list from site photos", "Comparative statement of 3 bids", "IS 456 span/depth check for a 4.5 m slab"] }
];
const bySlug = Object.fromEntries(TRADES.map((t) => [t.slug, t]));
const tradeFor = (slug) => bySlug[String(slug || "").toLowerCase()] || null;

// The first WhatsApp message from a trade page's link: "Hi! I am a plumber 🔧" (any case, any language
// greeting before it). Only a short introduction counts, so a real question about painting is not taken
// for "I am a painter".
const waText = (t) => `Hi! I am ${/^[aeiou]|^AC\b/i.test(t.short) ? "an" : "a"} ${t.short} ${t.emoji}`;
function tradeFromIntro(text) {
  const s = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (s.length > 80 || !/\b(i am|i'm|im|i work as|me)\b/.test(s)) return null;
  return TRADES.find((t) => t.detect.test(s)) || null;
}
// One line added to the AI's instructions when the person's trade is known.
const tradeInstruction = (t) => t ? `\n\nThe person asking is a ${t.name}. Pitch the answer at that work: use the words, tools, sizes and checks a ${t.short} uses on site, and point to the relevant calculator or tool on this app when it helps.` : "";

module.exports = { TRADES, tradeFor, tradeFromIntro, tradeInstruction, waText };
