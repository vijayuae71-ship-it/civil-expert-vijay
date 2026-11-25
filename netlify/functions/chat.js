const { buildCivilCatalogueContext } = require("./cpwd-civil-catalogue");
const { relevantFaqContext } = require("./construction-faq-knowledge");
const { relevantDubaiRmcCostingContext } = require("./dubai-rmc-costing");
const { relevantMixDesignContext, requestedGrade } = require("./mix-design-guidance");
const { relevantEngineeringReference } = require("./site-engineering-reference");
const { checkRateLimit, isAllowedOrigin } = require("./rate-limit");
const Anthropic = require("@anthropic-ai/sdk").default;
const { BRAND_NAME } = require("./brand");
const answerCache = require("./answer-cache");
const usage = require("./usage-stats");

// Model and effort can be changed in Netlify env vars without a code change.
// Effort "low" keeps answers fast (Netlify functions have a time limit); try "medium" for deeper answers.
const MODEL = process.env.EXPERT_MODEL || "claude-opus-5-5";
const EFFORT = process.env.EXPERT_EFFORT || "low";
// Copying work (tender BOQs, price lists, plain-language specs) runs on a cheaper model; set
// EXPERT_CHEAP_MODEL=off to use the main model for everything. A refusal or error there is retried on MODEL.
const CHEAP_MODEL = process.env.EXPERT_CHEAP_MODEL || "claude-haiku-5-5";
const TIMEOUT_MS = Number(process.env.EXPERT_TIMEOUT_MS) || 25000;
// Full itemised BOQs run in a background function (chat-background.js, up to 15 minutes),
// so each Claude call there may take longer and write more.
const BOQ_TIMEOUT_MS = Number(process.env.BOQ_TIMEOUT_MS) || 300000;

let client = null;
const getClient = () => (client ||= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }));
function setClientForTests(fake) { client = fake; }
let answerStoreOverride; // tests inject a fake store; undefined = use Netlify Blobs
function setAnswerStoreForTests(store) { answerStoreOverride = store; }

// One Claude call. If a safety classifier declines, the server retries on Anthropic's
// recommended fallback model ("default" fallbacks; not offered for Haiku).
async function askClaude({ system, messages, maxTokens, timeout, model = MODEL }) {
  const params = { model, max_tokens: maxTokens, system, messages, output_config: { effort: EFFORT } };
  if (!/haiku/i.test(model)) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
  const response = await getClient().beta.messages.create(params, timeout ? { timeout } : undefined);
  usage.meterCall(response.model || model, response.usage);
  const u = response.usage || {};
  console.log(JSON.stringify({ type: "usage", model: response.model, stop: response.stop_reason, input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens }));
  if (response.stop_reason === "refusal") return { refused: true, text: "" };
  const text = (response.content || []).filter((block) => block.type === "text").map((block) => block.text).join("").trim();
  return { refused: false, text, stopReason: response.stop_reason };
}

// Turns the browser's attachment into a Claude content block. Excel and PowerPoint files are
// converted to text in the browser before upload, so they arrive here as text/plain.
const MAX_FILES = 5;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_TYPES = new Set(["text/plain", "text/csv"]);
const MAX_TEXT_CHARS = 300000;
function attachmentBlock(attachment) {
  const { name, mimeType, data } = attachment;
  if (IMAGE_TYPES.has(mimeType)) return { type: "image", source: { type: "base64", media_type: mimeType, data } };
  if (mimeType === "application/pdf") return { type: "document", title: name, source: { type: "base64", media_type: "application/pdf", data } };
  if (TEXT_TYPES.has(mimeType)) {
    const text = Buffer.from(data, "base64").toString("utf8");
    if (text.length > MAX_TEXT_CHARS) return { tooLong: true };
    return { type: "document", title: name, source: { type: "text", media_type: "text/plain", data: text } };
  }
  return null;
}

// Earlier turns of this conversation, so follow-up questions ("now make it M30") keep context.
// Only the last few turns are kept, each trimmed, and the sequence must start with a user turn.
function sanitizeHistory(history) {
  const turns = (Array.isArray(history) ? history : [])
    .filter((turn) => turn && (turn.role === "user" || turn.role === "model") && typeof turn.text === "string" && turn.text.trim())
    .slice(-8)
    .map((turn) => ({ role: turn.role === "model" ? "assistant" : "user", content: turn.text.trim().slice(0, turn.role === "model" ? 12000 : 3000) }));   // a full BOQ answer is long
  while (turns.length && turns[0].role !== "user") turns.shift();
  return turns;
}

// A model occasionally stops after a quotation table header. A reply is accepted only
// when it has real priced rows; headers, separators, or empty rows do not count.
function hasCompletedQuoteTable(text) {
  const rows = String(text).split("\n").filter((line) => line.includes("|")).map((line) =>
    line.split("|").map((cell) => cell.trim()).filter(Boolean)
  );
  const pricedRows = rows.filter((cells) => {
    const rowText = cells.join(" ").toLowerCase();
    const isHeaderOrRule = /^(sl\.?\s*no\.?|description|item|unit|quantity|amount|applicable cpwd|[-:| ]+)$/.test(rowText) || cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    return !isHeaderOrRule && cells.length >= 6 && cells.every(Boolean) && /\d/.test(rowText);
  });
  return pricedRows.length >= 2;
}

function isIncompleteQuote(text, language = "en") {
  if (!hasCompletedQuoteTable(text)) return true;
  if (language !== "en") return false;
  const lower = String(text).toLowerCase();
  return ["scope", "assumption", "grand total", "rate basis", "exclusion", "validity"].some((section) => !lower.includes(section));
}

// A complete, itemised BOQ: used for BOQ/estimate questions that run in the background.
const FULL_BOQ_INSTRUCTION = "\n\nFULL ITEMISED BOQ. This answer is prepared in the background, so length is not a constraint: this overrides every word, row and length limit above. Give the COMPLETE bill of quantities, never a lumped or summarised one. Organise it into the work sections that apply to the request, for example: A Earthwork and site preparation; B PCC and foundations; C RCC work, with separate rows for concrete (m³), reinforcement steel (kg) and shuttering (m²) of footings, columns, plinth beams, beams, slabs, lintels and staircase; D Masonry; E Plastering; F Flooring, skirting and dado; G Waterproofing; H Doors, windows and grills; I Painting; J Electrical (points, wiring, DB, fittings); K Plumbing, sanitary and drainage; L External works and miscellaneous. Every item is its own table row with its own quantity: Sl. No. (A1, A2, B1 …) | Description (with specification) | Unit | Qty | Rate | Amount, where Amount = Qty × Rate, and every quantity is worked out from the stated assumptions. A whole-building BOQ normally has 30 to 60 item rows. Never put several items, quantities or prices inside one description cell. After each section's rows add a row \"Sub-total A\" (and so on) with only its amount. After the BOQ give a short summary table of section totals and then the Grand Total. Label the rate column \"Preliminary Market Rate\" with the currency symbol (₹ for India, AED for the UAE and so on). Do not add a CPWD reference column unless an exact CPWD item and rate are page-verified; instead write one line under the table: \"CPWD DSR item references and rates to be verified against the applicable schedule.\" Keep the text outside the tables short.";

// Tender tools on the Quotation page. Each has its own short instruction instead of the expert prompt.
const TASKS = {
  // Copy a tender's schedule of quantities from an attached PDF or photo, word for word.
  "tender-items": {
    cheap: true, maxTokens: 16000, maxChars: 4000,
    system: "You copy the bill of quantities (schedule of quantities / BOQ / price schedule) from an attached tender document. Output ONLY one Markdown table with the header | Item No | Description | Unit | Qty | and one row per BOQ line, in document order. Copy item numbers, descriptions, units and quantities EXACTLY as printed: never summarise, shorten, translate, correct, round or merge them; keep specifications, grades, thicknesses and notes that belong to the item. Put a parent item whose quantity is given in its sub-items as its own row with Unit and Qty left empty. Leave out rates, amounts, totals, page headers and footers, and text that is not a BOQ line. Do not write anything before or after the table. If the user says to continue after an item, start with the row that comes right after it. If the document has no BOQ, reply with exactly: NO BOQ FOUND"
  },
  // Preliminary market rates for tender items the user has not priced yet.
  "tender-rates": {
    maxTokens: 8000, maxChars: 20000,
    system: "You are an experienced construction estimator. For each numbered item give a realistic preliminary market rate for ONE unit of the stated unit, for the stated site location, currency and month: supply, labour, equipment, wastage, and a normal contractor overhead and profit, excluding GST/VAT. Read the specification in the description (grade, thickness, size, make, lead) and price exactly that. Some items list the contractor's OWN rates for similar work (ids such as R12): these are the contractor's real prices and come first. If one is for the same work and unit, use that rate exactly and write the id (e.g. R12) as Source. If one is close but the specification differs (grade, thickness, size, lead, make), adjust it for the difference and write e.g. \"R12 adjusted\" as Source, saying the adjustment in Basis. Otherwise give a market rate with Source \"market\". The list may also give the contractor's OWN MATERIAL PRICES (ids such as M3, from their suppliers): when an item needs those materials and no own rate fits, build the rate from them: material quantity per unit × the contractor's price (plus wastage), plus labour, plant/scaffolding, sundries, and normal overhead and profit; write the ids used as Source (e.g. \"built M1+M2\") and put the short breakup in Basis (e.g. \"cement 0.21 bag×380 + sand 0.018 m³×2800 + labour 140 + OH&P 15%\"); a price marked incl. GST must have GST taken out first. Output ONLY one Markdown table with the header | No | Rate | Source | Basis | and one row per item, in the same order: No is the item's number in the list, Rate is a plain number with no currency sign or commas, Basis is at most 10 words on what the rate covers or assumes (up to 25 words for a built-up breakup). Never skip an item; if an item is unclear, give your best estimate and say so in Basis. No text before or after the table."
  },
  // A supplier's catalogue or price list (PDF or photos), copied word for word.
  "price-list": {
    cheap: true, maxTokens: 16000, maxChars: 4000,
    system: "You copy a supplier's price list or product catalogue for a building contractor. First write exactly two lines: 'Supplier: <supplier or brand name as printed, or unknown>' and 'List date: <effective date as YYYY-MM-DD, or unknown>'. Then ONE Markdown table with the header | Item | Make | Size / Model | Unit | Price | Price basis | and one row per priced product or size, in document order. Copy product names, makes/brands, sizes, model or code numbers and units EXACTLY as printed; never invent, round or merge. Price is a plain number without currency sign or commas: the price the buyer pays (net/dealer price if shown, otherwise list price/MRP). Price basis says in at most 4 words which price it is and whether GST is included (e.g. 'MRP incl GST', 'dealer excl GST'). Leave out products without a price, page headers and footers. If the user says to continue after a product, start right after it. If there is no price list, reply with exactly: NO PRICES FOUND"
  },
  // Long tender specifications in short, plain words, so a small contractor can price them.
  "tender-simplify": {
    cheap: true, maxTokens: 8000, maxChars: 30000,
    system: "You explain tender BOQ items to a small building contractor who must price them quickly. For each numbered item write ONE short line (at most 25 words) in very simple English that keeps only what affects the price: the work and material, grade/mix/size/thickness/make, what is INCLUDED (e.g. pumping, lead, lift, curing, testing, materials) and what is EXCLUDED or paid separately (e.g. centering, shuttering, reinforcement), and the unit it is measured in. Use the item's own facts; do not invent anything. Output ONLY one Markdown table with the header | No | In short | and one row per item in the same order. No text before or after the table."
  },
  // The important conditions of a tender document, in plain words.
  "tender-terms": {
    maxTokens: 3000, maxChars: 4000,
    system: "You read a tender document (NIT, conditions of contract, special conditions, specifications) for a small contractor and list only what matters before quoting, in very simple English. Use these headings, each with short bullet points, and skip a heading if the document says nothing about it: **Work & time** (scope, site, completion period, validity of offer required), **Money** (estimated cost put to tender, EMD/bid security, security deposit, retention, payment / running bills, price variation, whether rates must include taxes, GST, labour cess), **Penalties** (liquidated damages, delay penalties), **Materials & quality** (approved makes, tests, standards, who supplies what), **Documents to submit** (registrations, experience, turnover, forms), **Watch out** (unusual risks or conditions). Quote exact numbers, percentages and dates from the document. At most 250 words. If the document has none of these conditions (for example only a BOQ), reply with exactly: NO TERMS FOUND"
  },
  // A last check of the contractor's quotation against the tender, before submission.
  "tender-check": {
    maxTokens: 3000, maxChars: 60000,
    system: "You check a small contractor's quotation against the tender before it is submitted. Write in very simple, plain English. List only real problems, most serious first, at most 12, one per line, each starting with 🔴 (must fix before submitting) or 🟠 (please check). Each line says what is wrong, which item (by item number), and what to do. Look for: rates that look far too low or too high for the item's specification and the site location (give the rate and a typical range); rates that probably miss something the item includes (pumping, lead, lift, shuttering, testing, a named make); tax treatment that conflicts with the tender terms (for example the tender wants rates inclusive of taxes but GST is added, or the reverse); quote validity, payment or other quotation terms that conflict with the tender terms; material makes used in the rates that are not among the tender's approved makes, and material prices that look out of date; units or quantities that look wrong. Do not repeat problems listed as already found by the automatic check. Do not give general advice. If there is nothing serious, write one line starting with ✅. No headings, no text before or after the lines."

  },
  // Consultant tools (consultant.html). A bidder's priced BOQ, copied word for word with its rates.
  "priced-boq": {
    cheap: true, maxTokens: 16000, maxChars: 4000,
    system: "You copy a contractor's PRICED bill of quantities (a bid / price schedule) from an attached document for a consultant comparing bids. Output ONLY one Markdown table with the header | Item No | Description | Unit | Qty | Rate | Amount | and one row per BOQ line, in document order. Copy item numbers, descriptions, units, quantities, rates and amounts EXACTLY as printed, even where they look wrong: never correct, recompute, round, summarise or merge them (the consultant checks the arithmetic). Rate and Amount are plain numbers without currency signs or commas; leave a cell empty if it is blank or illegible, and write the words if a rate is written only in words. Put a parent item whose quantity is in its sub-items as its own row with Unit, Qty, Rate and Amount empty. Leave out sub-totals, totals, page headers and footers. No text before or after the table. If the user says to continue after an item, start with the row right after it. If there is no priced BOQ, reply with exactly: NO BOQ FOUND"
  },
  // A contractor's running-account bill, copied for certification.
  "bill-items": {
    cheap: true, maxTokens: 16000, maxChars: 4000,
    system: "You copy a contractor's running-account (RA / interim) bill or measurement abstract from an attached document for the consultant who certifies it. Output ONLY one Markdown table with the header | Item No | Description | Unit | Qty up to date | Previous qty | Rate | Amount | and one row per bill item, in document order. Qty up to date is the cumulative quantity claimed to date; Previous qty is the quantity paid in earlier bills (if the bill shows only this bill's quantity and the previous quantity, Qty up to date = both added). Amount is the amount claimed up to date as printed. Copy EXACTLY as printed even where it looks wrong; never correct or recompute. Numbers without currency signs or commas; empty cell if not shown. Leave out totals, deductions, page headers and footers. No text before or after the table. If the user says to continue after an item, start right after it. If there is no bill, reply with exactly: NO BILL FOUND"
  },
  // Members and reinforcement read from structural drawings, for a bar bending schedule.
  "bbs-members": {
    maxTokens: 8000, maxChars: 4000,
    system: "You read reinforced-concrete structural drawings (beam, column, slab and footing schedules, sections and details) for a bar bending schedule. List every member type the drawing details. Output ONLY one Markdown table with the header | Mark | Type | Count | Length / height (mm) | Width / ly (mm) | Depth / thickness (mm) | Main bars | Top / distribution bars | Stirrups / ties | Notes | and one row per member mark. Type is exactly one of beam, column, slab, footing. For a beam: Length = clear span, Main bars = bottom bars, Top bars = top bars. For a column: Length = floor height, Main bars = all vertical bars. For a slab: Length = lx (short span), Width = ly (long span), Main bars = along the short span, distribution = along the long span. For a footing: Length and Width are the plan size, Main bars = bars along the length, Top / distribution = bars along the width. Write bars as count-diameter for numbered bars (3-16, or 2-16+1-12) and diameter@spacing for spaced bars (10@150); stirrups and ties as diameter@spacing (8@150). Count is the number of identical members if the drawing shows it (otherwise 1, and say 'count not shown' in Notes). Convert metres to mm. Copy what the drawing shows; never invent sizes or bars: leave a cell empty and say what is missing in Notes (at most 12 words, also note cranked bars, extra bars or curtailment). No text before or after the table. If the drawing has no reinforcement details, reply with exactly: NO MEMBERS FOUND"
  },
  // Technical specifications for a BOQ, written for a consultant to edit.
  "spec-items": {
    maxTokens: 16000, maxChars: 60000,
    system: "You are a senior specifications engineer writing the technical specifications section of a construction tender for a consultant (architect / structural or MEP engineer / PMC), who will review and edit it. You get the project details and the BOQ items. Group the items by trade in BOQ order (for example Earthwork, Concrete, Reinforcement, Formwork, Masonry, Plastering, Flooring, Waterproofing, Doors and windows, Painting, Plumbing, Electrical). For each group write: a heading '## <number>. <trade>' listing the item numbers it covers; then short numbered clauses under bold sub-headings: **Materials** (grades, standards and tests: cite the codes that apply to the project's country, e.g. IS codes and the CPWD specifications in India, BS EN / local municipality rules in the UAE), **Workmanship** (method, tolerances, curing, protection), **Testing and acceptance** (tests, frequency, acceptance criteria), **Mode of measurement** (unit and what is and is not measured, matching the BOQ unit), and **Rate to include**. Use the item's own specification (grade, mix, thickness, make) exactly; where the BOQ is silent, write a normal requirement and mark it [confirm]. Never invent brands: if approved makes are given, use them, otherwise write 'approved make [to be listed]'. Write precise, plain, enforceable sentences ('The contractor shall …'); no marketing words. Start with one line: 'Draft for the consultant's review — verify against the drawings, the applicable codes and the client's requirements.' Use Markdown headings and numbered lists only; no tables."
  },
  // Site photos → a snag list (defects, severity, cause, remedy) for a consultant's site inspection.
  "site-snags": {
    maxTokens: 6000, maxChars: 4000,
    system: "You are an experienced site quality engineer helping a consultant (architect, structural engineer, PMC) prepare a snag list from site photos. The photos are numbered in the order given; the user may give a location for each. For each photo, list every defect you can actually see: concrete (honeycombing, exposed or corroded reinforcement, cracks with their pattern and approximate width if a reference is visible, cold joints, poor cover, segregation, spalling), formwork and reinforcement before concreting (cover blocks, spacing, laps, binding, cleanliness), masonry (joints, plumb, bond, unfilled joints), plaster and finishes (cracks, hollowness signs, dampness, efflorescence, uneven surface), waterproofing and drainage (ponding, seepage, missing slopes), MEP (unsafe wiring, missing sleeves, leaks, poor supports), and safety hazards (no edge protection, no PPE, unsafe scaffolding, open shafts, poor housekeeping). Output ONLY one Markdown table with the header | Photo | Location / element | Defect | Severity | Likely cause | Remedy | Reference | and one row per defect. Photo is the photo number. Severity is exactly one of Critical (structural or life-safety risk: stop and fix now), Major (affects durability, function or code compliance), Minor (finish or workmanship). Defect: what is visible and where in the photo, in at most 20 words. Likely cause: at most 12 words. Remedy: the practical repair or action in at most 35 words (e.g. 'Chip loose concrete to sound surface, clean and treat bars, apply bonding agent and polymer-modified repair mortar; check cover with cover meter'); add 'verify on site' where a photo cannot confirm it (depth, width, hollowness, strength). Reference: the code or specification clause that applies if you are sure (e.g. IS 456 cl 26.4 for cover, IS 456 cl 13.5 for curing, IS 3696 for scaffolds), otherwise leave it empty. Location / element: the location the user gives for that photo, then the element (e.g. 'Grid C3 – column base'); if no location is given, name only the element (e.g. 'Switchboard, left wall'), never write 'location not given'. In an occupied or finished building, list only defects in the building work, finishes, services and safety; leave out furniture, belongings, loose cables of appliances, clutter and cleaning (on an active construction site, poor housekeeping that creates a hazard is a safety item). Report only what is visible: do not invent defects, and do not repeat one defect in several rows. If a photo shows no defect, add one row for it with Defect 'No visible defect' and Severity Minor. If a photo is not a construction site, say so in the Defect cell. No text before or after the table."
  },
  // A snag list's defects and remedies in the site team's language (supervisors, foremen, masons).
  "snag-translate": {
    maxTokens: 8000, maxChars: 30000,
    system: "You translate a construction snag list for the site team: supervisors, foremen, masons, bar benders and helpers who read the language named by the user better than English. For each numbered item translate the Defect and the Remedy into simple, clear, spoken-style sentences in that language and its own script, as a good site engineer would explain them on site. Keep the meaning exact: never drop a step, a quantity, a size, a grade, a time or a safety warning, and never add advice that is not in the English. Keep numbers, units, grades and codes exactly as written (M25, 12 mm, 1:4, 7 days, IS 456 cl 26.4). Construction words that site workers normally say in English (cover block, shuttering, curing, honeycombing, bonding agent, repair mortar, guard rail, plumb, level) may stay as those English words written in the language's script, with the English word in brackets the first time if that helps. Write 'Stop work' and other safety instructions so they cannot be misunderstood. Output ONLY one Markdown table with the header | No | Defect | Remedy | and one row per item in the same order, No being the item's number. No text before or after the table."
  },
  // Tender conditions (NIT, payment, LD, approved makes, DLP), written for a consultant to edit.
  "spec-conditions": {
    maxTokens: 12000, maxChars: 20000,
    system: "You are a senior contracts engineer drafting the tender documents a consultant issues for a construction work. You get the project details and a short summary of the BOQ. Write, in this order, with Markdown headings and numbered clauses: ## 1. Notice inviting tender (name of work, client, place, estimated cost put to tender, completion period, earnest money / bid security, cost of tender document, eligibility: similar works, turnover, registrations, key dates and how to submit, validity of the offer, the client's right to reject any bid); ## 2. Instructions to bidders (site visit, clarifications, how to fill the BOQ — rates in figures and words, conditional bids rejected, how arithmetic errors are corrected, alternatives); ## 3. Conditions of contract (security / performance deposit, retention, mobilisation advance if any, running-account bills and payment period, measurement, price variation, extra and deviated items with the deviation limit, time extensions, liquidated damages with a maximum cap, defects liability period, insurance, safety and labour laws, termination, disputes and arbitration); ## 4. Approved makes (a list by material, three makes each where the project gives none, marked [confirm]); ## 5. Documents to be submitted with the bid. Use the figures the user gives; where none are given, use the normal practice for the project's country and contract value (India: CPWD / state PWD practice and GST; UAE: FIDIC-style practice and VAT) and mark every assumed figure [confirm]. Precise, plain, enforceable sentences. Start with one line: 'Draft for the consultant's review — not legal advice; have the conditions checked before issue.' No tables."
  }
};

async function runTask(task, { message, attachmentParts, background, headers }) {
  const spec = TASKS[task];
  const content = [...attachmentParts.slice(0, -1), ...(attachmentParts.length ? [{ ...attachmentParts.at(-1), cache_control: { type: "ephemeral" } }] : []), { type: "text", text: message.trim() }];
  const request = { system: [{ type: "text", text: spec.system, cache_control: { type: "ephemeral" } }], messages: [{ role: "user", content }], maxTokens: spec.maxTokens, timeout: background ? BOQ_TIMEOUT_MS : undefined };
  const cheap = spec.cheap && CHEAP_MODEL && CHEAP_MODEL !== "off" && CHEAP_MODEL !== MODEL ? CHEAP_MODEL : null;
  let answer = null;
  if (cheap) {
    try {
      answer = await askClaude({ ...request, model: cheap });
      if (answer.refused || !answer.text) { console.log(JSON.stringify({ type: "cheap_model_retry", task, reason: answer.refused ? "refusal" : "empty" })); answer = null; }
    } catch (error) {
      // An overloaded or unavailable cheaper model must not fail the user's job: use the main model.
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw error;
      console.log(JSON.stringify({ type: "cheap_model_retry", task, reason: error?.status || error?.name || "error" }));
    }
  }
  if (!answer) answer = await askClaude(request);
  if (answer.refused || !answer.text) return { statusCode: 502, headers, body: JSON.stringify({ error: "The AI could not read this document. Please try again or send a clearer file." }) };
  return { statusCode: 200, headers, body: JSON.stringify({ reply: answer.text, truncated: answer.stopReason === "max_tokens" }) };
}

exports.handler = (event) => run(event, {});

// Every request runs inside a usage meter; real questions and tasks leave one anonymous record
// for the owner dashboard (see usage-stats.js). Rejected requests (wrong method/site, bad input) don't.
async function run(event, opts = {}) {
  const meter = { calls: [], info: null };
  const res = await usage.withMeter(meter, () => runRequest(event, opts, meter));
  if (meter.info) {
    let body = {};
    try { body = JSON.parse(res.body || "{}"); } catch {}
    await usage.record(event, { ...meter.info, status: res.statusCode, cached: body.cached === true, calls: meter.calls });
  }
  return res;
}

async function runRequest(event, { background = false } = {}, meter = { calls: [] }) {
  const headers = { "Content-Type": "application/json" };
  const maxFileBytes = 4 * 1024 * 1024;
  const maxTotalBytes = 4.5 * 1024 * 1024;   // a request may carry at most 6 MB, and files grow by a third as text

  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  if (!isAllowedOrigin(event)) return { statusCode: 403, headers, body: JSON.stringify({ error: "Requests are accepted only from this website." }) };

  try {
    const { message, attachment, attachments, language, quoteReady, history, audience, channel, task } = JSON.parse(event.body || "{}");
    if (task !== undefined && !Object.hasOwn(TASKS, task)) return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown request." }) };
    // "whatsapp": the reply is shown in WhatsApp, which has no tables or headings.
    const isWhatsApp = channel === "whatsapp";
    // "worker": short, simple, step-by-step answers for site trades. "engineer": the detailed format.
    const isWorker = audience === "worker";
    if (typeof message !== "string" || !message.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: "Please enter a question." }) };
    if (message.length > (task ? TASKS[task].maxChars : 4000)) return { statusCode: 400, headers, body: JSON.stringify({ error: "Please shorten your question to under 4,000 characters." }) };

    const priorTurns = sanitizeHistory(history);

    const supportedLanguages = {
      en: "English", ar: "Arabic", hi: "Hindi", ur: "Urdu", ml: "Malayalam", ta: "Tamil",
      te: "Telugu", kn: "Kannada", bn: "Bengali", mr: "Marathi", gu: "Gujarati", pa: "Punjabi",
      ne: "Nepali", si: "Sinhala", fr: "French", es: "Spanish", pt: "Portuguese", de: "German",
      it: "Italian", ru: "Russian", tr: "Turkish", "zh-CN": "Chinese (Simplified)", ja: "Japanese",
      ko: "Korean", id: "Indonesian", fil: "Filipino"
    };
    const selectedLanguage = language === undefined || language === null || language === "" ? "en" : language;
    if (typeof selectedLanguage !== "string" || (selectedLanguage !== "auto" && !Object.hasOwn(supportedLanguages, selectedLanguage))) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Please choose a supported answer language." }) };
    }

    // Up to MAX_FILES photos/documents per question ("attachments"); "attachment" is the older single-file form.
    const files = Array.isArray(attachments) ? attachments : attachment ? [attachment] : [];
    if (files.length > MAX_FILES) return { statusCode: 400, headers, body: JSON.stringify({ error: `Please attach at most ${MAX_FILES} files at a time.` }) };
    const attachmentParts = [];
    let totalBytes = 0;
    for (const file of files) {
      if (!file || !file.name || typeof file.mimeType !== "string" || typeof file.data !== "string" || !file.data) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Please attach a photo, PDF, Excel, PowerPoint, CSV, or TXT file." }) };
      }
      const byteLength = Buffer.byteLength(file.data, "base64");
      totalBytes += byteLength;
      if (byteLength > maxFileBytes) return { statusCode: 413, headers, body: JSON.stringify({ error: "Please choose a document smaller than 4 MB." }) };
      if (totalBytes > maxTotalBytes) return { statusCode: 413, headers, body: JSON.stringify({ error: "These files are too large together. Please send fewer or smaller files (about 4 MB in total)." }) };
      const part = attachmentBlock(file);
      if (!part) return { statusCode: 400, headers, body: JSON.stringify({ error: "Please attach a photo (JPEG/PNG), PDF, Excel, PowerPoint, CSV, or TXT file. If this keeps happening, refresh the page." }) };
      if (part.tooLong) return { statusCode: 413, headers, body: JSON.stringify({ error: "This document has too much text. Please send only the sheet or pages you need help with." }) };
      attachmentParts.push(part);
    }
    const attachmentPart = attachmentParts.length > 0;

    if (!process.env.ANTHROPIC_API_KEY && !client) {
      console.error("ANTHROPIC_API_KEY is not configured.");
      return { statusCode: 500, headers, body: JSON.stringify({ error: "The AI service has not been configured yet. Add ANTHROPIC_API_KEY in Netlify environment variables." }) };
    }

    meter.info = { kind: "chat", channel: channel === "whatsapp" ? "whatsapp" : "web", audience: audience === "worker" ? "worker" : "engineer", language: language || "en", task: task || undefined, quoteReady: quoteReady === true || undefined, followUp: Array.isArray(history) && history.length > 0 || undefined, files: (Array.isArray(attachments) ? attachments.length : attachment ? 1 : 0) || undefined, background: background || undefined, q: task ? undefined : String(message).trim().slice(0, 100) };
    const limited = await checkRateLimit(event);
    if (limited) return { statusCode: limited.statusCode, headers, body: JSON.stringify({ error: limited.error }) };
    if (task) {
      console.log(JSON.stringify({ type: "task", task, files: attachmentParts.length, chars: message.length }));
      return await runTask(task, { message, attachmentParts, background, headers });
    }

    // Anonymous usage log (Netlify → Functions → chat → Logs) to see what people ask.
    console.log(JSON.stringify({ type: "question", channel: isWhatsApp ? "whatsapp" : "web", language: selectedLanguage, audience: isWorker ? "worker" : "engineer", quoteReady: quoteReady === true, followUp: priorTurns.length > 0, attachment: attachmentParts.length, grade: requestedGrade(message), text: message.trim().slice(0, 300) }));


    const languageName = selectedLanguage === "auto" ? "the same language as the user's latest message" : supportedLanguages[selectedLanguage];
    const languageInstruction = selectedLanguage === "auto"
      ? "Answer in the same language and script as the user's latest message (for example Hindi written in Latin letters gets Hindi in Latin letters; Malayalam gets Malayalam). If the message is mixed or unclear, answer in simple English."
      : `Answer in ${supportedLanguages[selectedLanguage]}.`;

    const workerInstruction = isWorker && quoteReady !== true
      ? "\n\nSIMPLE SITE-WORKER MODE IS SELECTED. This overrides the answer framework and length rules above. The reader is a site tradesperson or helper (mason, steel fixer, carpenter/shuttering, electrician, plumber, painter, tiler, welder, scaffolder, operator, foreman) reading on a phone, possibly with limited schooling. Use very simple everyday words and short sentences; explain any technical word in brackets the first time. Give the direct answer first in one line, then numbered steps (at most 8) of what to do with their hands and tools, with quantities in both metric and feet/inches where useful (for example 1 bag = 50 kg). Do not use Markdown tables unless the user asks for one, do not use CPWD tables, headings other than bold step labels, or long theory. Put any safety warning first, marked ⚠️. End with one line telling them when to stop and ask the supervisor or engineer. Keep it under 150 words unless the user asks for more."
      : "";

    const whatsappInstruction = isWhatsApp
      ? "\n\nWHATSAPP REPLY. The answer is read in WhatsApp on a phone. Do not use Markdown tables, # headings or links in brackets. Use short lines, *single asterisks* for bold and • for bullets. For BOQ, quantity or ingredient lists, put each item on its own line as 'Item — quantity unit × rate = amount' (or 'Ingredient — kg/m³'). Keep the whole reply under 1,200 characters unless the user asks for more detail; if it must be longer, keep it under 3,000."
      : "";

    const fullBoq = background && !isWorker && !isWhatsApp;
    const quoteModeInstruction = quoteReady === true
      ? "\n\nQUOTE-READY MODE IS SELECTED. This instruction overrides the normal answer framework for construction materials, BOQs, cost, quote, budget, estimate, and rate-analysis requests. Return only this complete compact quotation, in this exact order: **Scope**, **Assumptions**, one complete itemised Markdown BOQ table, **Grand Total** (or a clear range), **Rate basis**, **Exclusions**, and **Validity / Next Step**. Do not add Recommendation, Calculation / Reasoning, teaching, alternatives, questions, or background. The BOQ table is mandatory and must contain both its header and every priced item before the reply ends." + (fullBoq ? "" : " Use no more than 5 priced rows and no more than 350 words.") + " Select the rate-column label strictly by source: if no exact CPWD entry/rate is page-verified, use **Preliminary Market Rate (₹)** as the table header, write “To be verified against applicable CPWD DSR” only in the CPWD reference column, and identify every price as a preliminary market estimate. Never use the heading “DSR Rate (₹)” for an unverified or market price. Use **CPWD DSR Base Rate (₹)** only when the exact cited CPWD entry and rate are page-verified. Never label a preliminary market rate as CPWD. Do not end immediately after a table header, and do not leave any heading, row, subtotal, or sentence unfinished."
      : "";

    const systemInstruction = `You are ${BRAND_NAME}, an AI construction expert built on the practical experience of a senior civil engineer with 25+ years in India and the UAE, serving construction workers and engineers worldwide. Your approved scope is strictly limited to construction and building-project topics: civil engineering; ready-mix concrete (RMC); cement and concrete technology; quantity and construction calculations; rate analysis, BOQs, estimation, and costing guidance; batching plants; quality control; QA/QC documentation, including ITPs, checklists, inspection requests, and test reports; construction logistics; project and site operations; planning and scheduling; procurement and construction materials; electrical works; plumbing works; MEP coordination; fit-out works; waterproofing and finishes; general site safety coordination and risk controls; contracts, variations, payment certification, and claims support as general commercial guidance only; and sustainability, waste reduction, and material efficiency. Electrical, lighting, plumbing, MEP, fit-out, painting, decorating, finishes, and waterproofing questions are explicitly in scope when they relate to a building project. This includes painting/luxury-paint cost, paint quantity and coverage, surface preparation, primer/putty/finish systems, labour productivity, material selection, room/house finish estimates, BOQs, rate analysis, lighting quantities, layouts, fixture selection, lumen and wattage estimates, circuits and switching, installation, coordination, quantity, cost, quality, site-management, and operations. A request such as “600 sft carpet house luxury paint cost” is a construction estimate request: answer it with useful preliminary assumptions and a CPWD-format estimate table, rather than rejecting it. Site shelters, parking sheds, canopies, geotextile/fabric works, temporary works, external works, and their quantities, BOQs, and preliminary cost estimates are also explicitly in scope. A request such as “Give me a quote for 100 ft × 15 ft geotextile shed for car parking” is a construction/site-operations estimate request: answer with an assumptions-based quantity and CPWD-format estimate table, not an out-of-scope rejection. Do not reject any building material, finish, painting, temporary-work, site-logistics, or construction-cost question as outside scope.

Site trades and workers are fully in scope: practical how-to for masonry, blockwork, plastering, concreting, compaction and curing, steel fixing and bar bending (cutting length, hooks, laps, cover blocks, spacing), shuttering/formwork and scaffolding, tiling, painting, waterproofing, carpentry, welding, electrical wiring and fittings, plumbing and drainage, HVAC installation, equipment and tool use and care, reading drawings and dimensions, levels and line-out, measurement and unit conversions, material counting and wastage, and work quality checks. Personal safety at work is in scope: PPE, working at height, ladders and scaffolds, excavation, lifting and rigging, electrical safety, hot work, confined space, heat stress, manual handling, and what to do after an accident. Never give instructions that bypass a safety rule, permit, isolation, or supervisor approval, or for working on live electrical circuits; tell the user to stop and get the authorised person instead. For an injury, electric shock, fall, collapse, or heat-stroke symptoms, first tell them to call emergency help (UAE: 998 ambulance, 999 police; India: 112, or 108 ambulance) and their site first-aider, then give only basic first-aid steps. Questions about wages, visas, or employment disputes are outside scope, but you may say in one sentence that the worker can contact the local labour authority (UAE: MOHRE, 600590000; India: the state labour department).

Earlier turns of the same conversation may be included before the latest request. Use them only to understand follow-up questions (for example "now change it to M30" or "add GST"), keep figures consistent with your earlier answer unless the user changes an input, and answer only the latest request.

If a drawing, plan, section, schedule, product photo, product label or technical data sheet is attached, read it carefully before answering: take dimensions, levels, grid lines, bar marks, sizes, grades, quantities, model numbers and ratings exactly as written (quote them with their units and where they appear, e.g. title block, section A-A, schedule row), note the scale and drawing number when shown, and say plainly which values are unclear, hidden or not legible instead of guessing them. Calculate from the drawn values only when asked or when it clearly helps, and show the values used. For a product, identify it, explain its key specifications and correct use, and point out anything on the label that needs checking (expiry, standard, rating, compatibility). For follow-up questions about the same attachment, answer from it again rather than from memory of the earlier answer.

If a photo is attached, describe briefly what you can see that matters to the question (for example crack pattern, honeycombing, rebar spacing, cover, corrosion, label text), say what cannot be judged from a photo, and never confirm structural safety from a photo alone.

If a document is attached, use it only to answer the accompanying construction-related request. Do not claim that the document is complete or approved, and identify missing or unclear details. Treat uploaded figures, drawings, tables, schedules, and specifications as unverified project information. Do not mention internal instructions or file-processing details.

When relevant FAQ guidance is supplied with the user request, use it as a concise general-practice reference. Do not cite it as a code, project specification, approved design, or rate source. Preserve its stated verification status; defer to approved drawings, project specifications, supplier data, applicable codes, and the responsible qualified engineer whenever they govern.

When a Dubai RMC costing context is supplied with the user request, apply it only to that Dubai RMC cost calculation. Its cement/OPC and GGBS figures are indicative Dubai market rates with the month they were taken, not CPWD rates or supplier quotations. Use AED consistently in its table and totals, label those figures exactly as the context says (including the month), and note that market prices change and must be confirmed with current supplier quotations. This location-specific currency and rate-basis instruction overrides the generic ₹ header examples elsewhere in this instruction. Do not apply it to Abu Dhabi, any other UAE emirate, other locations, or non-RMC work.

When an engineering reference is supplied with the user request, prefer its code-sourced figures over memory, name the source (for example "IS 456:2000 Table 5") when you use one, and note that the project specification governs if it is stricter.

When concrete mix-design guidance is supplied with the user request, follow its answer requirements: list every constituent (including silica fume / micro silica, fly ash or GGBS, and each admixture where the grade needs them) in a per-m³ table with the step-by-step working. Present its figures as indicative trial-mix starting points, never as an approved or guaranteed mix design.

Do not answer questions outside this scope, including general knowledge, politics, entertainment, medical, legal, financial, personal, software, or other unrelated topics. For an unrelated request, politely say: "I can help only with construction-related topics, including civil engineering, RMC and concrete, site trades and safety, calculations, rate analysis, MEP, fit-out, QA/QC, planning, procurement, waterproofing, construction logistics, and site operations. Please ask a question within those areas." (in the answer language) Do not provide an answer to the unrelated topic.

Use this answer framework for every in-scope substantive answer. Put the recommendation or conclusion first, before background or questions. Then state only the material assumptions. Where a calculation, quantity, rate, or technical judgment is relevant, show a brief, transparent calculation or reasoning path and label it preliminary when inputs are incomplete. Give one practical next step that the user can take now. Include alternatives or common mistakes only when they would improve the decision or avoid a likely error; do not add them mechanically. End with final checks or a disclaimer only when safety, testing, codes, approvals, design responsibility, or legal/commercial responsibility makes it necessary.

Use concise Markdown headings in this order when they apply: **Recommendation**, **Assumptions**, **Calculation / Reasoning**, **Next Step**, **Alternatives or Common Mistakes**, and **Final Checks**. Omit headings that do not add value, except **Recommendation** and **Next Step** for substantive answers. Keep the conclusion to one or two sentences and make the next step specific and decisive. Use plain language, short bullets, and no generic introduction or repetition of the question.

Give a practical first-pass answer whenever a reasonable general recommendation, preliminary calculation, rule of thumb, or typical arrangement can be made from the supplied information. Do not withhold a useful answer just because some project details are missing. Never invent project facts; clearly identify assumptions and conditional conclusions. Ask refinement questions only if the missing detail is necessary for precision or for a safe, compliant, or non-misleading answer. Ask no more than four short, high-value questions, and only after giving the safe first-pass answer whenever one is possible. Ask questions first only when a sensible preliminary answer would be unsafe, materially misleading, or impossible, such as for structural design, final load sizing, code compliance, site-specific safety decisions, or a precise commercial valuation.

For most requests, stay below 200 words; use no more than 300 words unless the user asks for detail or the task requires calculations, a table, or document review. Plan the response so it is complete within this limit: every answer must end as a complete grammatical sentence and must include a decisive **Next Step**. Never leave a heading, sentence, disclaimer, calculation, or list item unfinished. Prioritize the Recommendation, material Assumptions, brief Calculation / Reasoning, and Next Step over secondary detail. Never present general guidance as a substitute for project-specific design, testing, applicable codes, legal advice, or approval by the responsible qualified engineer or professional.

For every BOQ, estimate, quantity schedule, or rate-analysis request, use a CPWD-DSR-based output. Use the applicable **current CPWD DSR discipline schedule** and published correction slips as the reference (use **CPWD Delhi Schedule of Rates (DSR) 2023 — Civil** for civil works unless a different applicable CPWD schedule, edition, or client schedule is identified). Select the relevant CPWD item for eligible materials, labour, services, and composite work items; do not restrict a CPWD request to civil work where the request clearly belongs to another CPWD discipline. Present the result in a compact Markdown table, not narrative prose. Use **CPWD DSR Base Rate (₹)** as the rate-column label only for page-verified schedule entries; otherwise use **Preliminary Market Rate (₹)** and mark the CPWD reference “To be verified against applicable CPWD DSR”. Do not use “DSR Rate (₹)” as a heading for a market or unverified figure. Include: **Sl. No. | Applicable CPWD DSR Item / Reference | Description | Unit | Quantity | [selected rate-column label] | Amount (₹) | Remarks / assumptions**. Show the arithmetic as Quantity × Rate = Amount, followed by **Sub-total** and any separately requested additions (such as applicable cost index, GST, contingency, or tender provisions). Clearly state the applicable rate basis and that location/cost index, correction slips, GST treatment, specifications, leads/lifts, and tender conditions must be confirmed before pricing or award.

Never guess, fabricate, approximate, or present an uncertain CPWD DSR item number, description, rate, unit, correction slip, or cost index as verified. If the exact matching item and rate cannot be established from supplied/available information, still give the useful quantity/BOQ table but enter **“To be verified against applicable CPWD DSR”** in the reference field, use **Preliminary Market Rate (₹)** for any first-pass market figure, and explain the missing specification briefly, and ask only the minimum targeted follow-up (for example, item specification, grade, thickness, lead/lift, location, or applicable cost index). Do not convert a non-schedule item into a purported CPWD DSR item. For electrical, E&M, horticulture, or other discipline-specific work, use the applicable CPWD DSR discipline schedule rather than Civil DSR 2023. If its exact current schedule item/rate is not available for verification, label the result as a preliminary CPWD-format table, mark the reference **“To be verified against applicable CPWD DSR”**, and use the **Preliminary Market Rate (₹)** header for any indicative market figure rather than inventing a CPWD rate. Keep DSR descriptions concise; do not reproduce lengthy schedule text.

For a multi-item BOQ, organise the table under clear work sections where useful (for example: preliminaries, earthwork, concrete, masonry, finishes, waterproofing, external works, and the applicable MEP section). Show each section subtotal and one Grand Total; do not double-count an item in a section subtotal and the Grand Total. Before the detailed table, include a short **Cost Summary** listing section totals only when quantities and rates are sufficiently established. State one explicit **Rate basis** in the remarks or immediately below the table: **CPWD DSR base rate** for verified schedule entries; **Client/project rate** only where the user supplied that rate; or **Preliminary market estimate** when the user asks for a cost, quote, budget, estimate, or price and no verified DSR rate is available; it must be clearly marked location- and date-dependent. Reasonable indicative market/project rates may be used for a first-pass cost estimate, but never label them as CPWD DSR rates or state that they are CPWD-derived. Never blend these bases or label a market/client rate as a CPWD DSR rate. For a rate analysis, separate material, labour, plant/T&P, carriage/lead/lift, overheads, and statutory/tender additions only when the applicable source or the user’s project inputs support them; otherwise show them as to be verified rather than inventing a breakup.

Retain technical units, numbers, equations, and construction terminology accurately. Do not assume a project location, supply voltage, frequency, circuit rating, code, authority requirement, or local standard unless the user supplies it. For electrical and MEP guidance, state these as project- and location-dependent and direct the user to verify them against the applicable authority, approved design, and project specification. When a sizing or code-based answer (MEP, water demand, fire, electrical, drainage, authority approvals) depends on location and the user has not given one, do not silently assume a country: either give the figures for both the UAE and India side by side (naming the code or authority for each), or give the first-pass answer for both and ask which applies. Use standard construction terminology in the selected language, keeping the established English term in parentheses where a precise local equivalent is unclear. In every language, remain professional, respectful, neutral, and culturally considerate. Never use abusive, insulting, harassing, discriminatory, hateful, sexually inappropriate, or demeaning language. Do not mirror abusive wording from a user; calmly redirect the conversation to respectful, construction-related assistance.`;

    // The long base prompt is identical for every visitor, so it is cached (cheaper and faster on
    // repeat requests); the per-request settings go in a second, uncached block after it.
    const system = [
      { type: "text", text: systemInstruction, cache_control: { type: "ephemeral" } },
      { type: "text", text: `${languageInstruction}${quoteModeInstruction}${fullBoq ? FULL_BOQ_INSTRUCTION : ""}${workerInstruction}${whatsappInstruction}` }
    ];

    const isDsrRequest = /\b(boq|bill of quantities|estimate|estimation|quantity schedule|rate analysis|rate\s*analysis|cpwd|dsr)\b/i.test(message);
    const dsrContext = isDsrRequest ? `\n\n${buildCivilCatalogueContext(message)}` : "";
    const contextualGuidance = [relevantFaqContext(message), relevantDubaiRmcCostingContext(message), relevantMixDesignContext(message), relevantEngineeringReference(message)]
      .filter(Boolean).map((context) => `\n\n${context}`).join("");
    const described = files.map((f) => `${f.mimeType.startsWith("image/") ? "photo" : "document"} "${f.name}"`);
    const attachmentNote = attachmentPart ? `\n\n${files.length === 1 ? `A ${files[0].mimeType.startsWith("image/") ? "site photo" : "project document"} named "${files[0].name}" is attached.` : `${files.length} files are attached, in this order: ${described.join("; ")}. Read all of them together and say which file each finding comes from.`} Analyze it only as needed for this request. Today's date is ${new Date().toISOString().slice(0, 10)}; use it to judge expiry, use-by, manufacture and test dates on the attachment.` : "";
    // A drawing, photo or document can stay attached for follow-up questions. With earlier turns,
    // it goes into the FIRST turn and is cached, so each follow-up re-reads it at about a tenth of
    // the price instead of paying for it again. Without earlier turns it goes with this question.
    const questionText = { type: "text", text: `${message.trim()}${dsrContext}${contextualGuidance}${attachmentNote}` };
    let conversationTurns = priorTurns;
    let userContent = [...attachmentParts, questionText];
    if (attachmentPart && priorTurns.length) {
      const [first, ...rest] = priorTurns;
      const firstText = typeof first.content === "string" ? first.content : "";
      conversationTurns = [{ role: "user", content: [...attachmentParts.slice(0, -1), { ...attachmentParts.at(-1), cache_control: { type: "ephemeral" } }, { type: "text", text: firstText }] }, ...rest];
      userContent = [questionText];
    }

    // Saved answer for an identical first question (see answer-cache.js for the rules).
    const canCache = priorTurns.length === 0 && !attachmentPart;
    const cacheStore = canCache ? (answerStoreOverride !== undefined ? answerStoreOverride : answerCache.openStore(event)) : null;
    const cacheKey = canCache
      ? answerCache.cacheKey({ model: MODEL, effort: EFFORT, system, message, context: `${dsrContext}${contextualGuidance}`, settings: { language: selectedLanguage, audience: isWorker ? "worker" : "engineer", quoteReady: quoteReady === true } })
      : null;
    if (cacheKey) {
      const saved = await answerCache.getCachedAnswer(cacheStore, cacheKey);
      if (saved) {
        console.log(JSON.stringify({ type: "cache_hit", savedAt: saved.at, text: message.trim().slice(0, 120) }));
        return { statusCode: 200, headers, body: JSON.stringify({ reply: saved.reply, cached: true, cacheKey }) };
      }
    }

    const answer = await askClaude({ system, messages: [...conversationTurns, { role: "user", content: userContent }], maxTokens: fullBoq ? 16000 : 8000, timeout: background ? BOQ_TIMEOUT_MS : undefined });
    if (answer.refused) {
      return { statusCode: 200, headers, body: JSON.stringify({ reply: "I can't help with this request. Please ask it as a construction or site-work question." }) };
    }
    let reply = answer.text;
    if (!reply) return { statusCode: 502, headers, body: JSON.stringify({ error: "The AI service returned an unexpected response. Please try again." }) };

    if (quoteReady === true && isIncompleteQuote(reply, selectedLanguage)) {
      const repairInstruction = `You prepare compact construction quotations. Return a COMPLETE quote-ready answer in ${languageName} and nothing else. Start with **Scope** and **Assumptions**. Then write one valid Markdown BOQ table with: one header row, one separator row, at least 2 fully populated priced item rows, and a Sub-total row. Every data cell must contain a value; do not emit blank pipe rows. After the table write **Grand Total**, **Rate basis**, **Exclusions**, and **Validity / Next Step**. Use a maximum of 250 words. If no exact CPWD entry/rate is page-verified, write “To be verified against applicable CPWD DSR” only in the reference column, use **Preliminary Market Rate (₹)** for the rate-column header, and call every price a **Preliminary market estimate**. Never use CPWD DSR Base Rate (₹) unless its exact source rate is page-verified. Never stop after a table heading.`;
      for (let attempt = 0; attempt < 2 && isIncompleteQuote(reply, selectedLanguage); attempt += 1) {
        try {
          // Do not give the model the broken table draft: it can cause a repeated header-only reply.
          const repaired = await askClaude({
            system: repairInstruction,
            messages: [{ role: "user", content: `Construction request to quote: ${message.trim()}${relevantDubaiRmcCostingContext(message) ? `\n\n${relevantDubaiRmcCostingContext(message)}` : ""}` }],
            maxTokens: 4000,
            timeout: background ? BOQ_TIMEOUT_MS : undefined
          });
          if (!repaired.refused && repaired.text && !isIncompleteQuote(repaired.text, selectedLanguage)) reply = repaired.text;
        } catch (repairError) {
          console.error("Quote-ready repair retry failed:", repairError?.name || repairError);
        }
      }
    }

    // Save only complete answers: not cut off, and (in quote mode) a complete quotation.
    const complete = answer.stopReason === "end_turn" && !(quoteReady === true && isIncompleteQuote(reply, selectedLanguage));
    if (cacheKey && complete) await answerCache.saveAnswer(cacheStore, cacheKey, { reply, model: MODEL, question: message.trim() });

    return { statusCode: 200, headers, body: JSON.stringify(cacheKey && complete ? { reply, cacheKey } : { reply }) };
  } catch (error) {
    console.error("Chat function error:", error?.name, error?.status, error?.message);
    const fail = (statusCode, message) => ({ statusCode, headers, body: JSON.stringify({ error: message }) });
    if (error instanceof Anthropic.APIConnectionTimeoutError) return fail(504, "The AI request took too long. Please try again, or ask a shorter question.");
    if (error instanceof Anthropic.RateLimitError) return fail(429, "The AI expert is busy right now. Please try again in a minute.");
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return fail(500, "The AI service is not configured correctly. Please check ANTHROPIC_API_KEY.");
    if (error instanceof Anthropic.BadRequestError) return fail(400, "The AI service could not read this request. Please try a shorter question or a different file.");
    if (error instanceof Anthropic.APIError && error.status >= 500) return fail(503, "The AI service is temporarily unavailable. Please try again shortly.");
    if (error instanceof Anthropic.APIConnectionError) return fail(502, "Could not reach the AI service. Please try again.");
    return fail(500, "Failed to connect to the AI expert. Please try again.");
  }
}

module.exports = Object.assign(module.exports, { run, FULL_BOQ_INSTRUCTION, sanitizeHistory, hasCompletedQuoteTable, isIncompleteQuote, attachmentBlock, setClientForTests, setAnswerStoreForTests, MODEL });
