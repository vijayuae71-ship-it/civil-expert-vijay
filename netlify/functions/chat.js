const { buildCivilCatalogueContext } = require("./cpwd-civil-catalogue");
const { relevantFaqContext } = require("./construction-faq-knowledge");
const { relevantDubaiRmcCostingContext } = require("./dubai-rmc-costing");
const { relevantMixDesignContext, requestedGrade } = require("./mix-design-guidance");
const { relevantEngineeringReference } = require("./site-engineering-reference");
const { checkRateLimit, isAllowedOrigin } = require("./rate-limit");
const Anthropic = require("@anthropic-ai/sdk").default;
const { BRAND_NAME } = require("./brand");
const answerCache = require("./answer-cache");

// Model and effort can be changed in Netlify env vars without a code change.
// Effort "low" keeps answers fast (Netlify functions have a time limit); try "medium" for deeper answers.
const MODEL = process.env.EXPERT_MODEL || "claude-opus-5-5";
const EFFORT = process.env.EXPERT_EFFORT || "low";
const TIMEOUT_MS = Number(process.env.EXPERT_TIMEOUT_MS) || 25000;

let client = null;
const getClient = () => (client ||= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 0 }));
function setClientForTests(fake) { client = fake; }
let answerStoreOverride; // tests inject a fake store; undefined = use Netlify Blobs
function setAnswerStoreForTests(store) { answerStoreOverride = store; }

// One Claude call. If a safety classifier declines, the server retries on Anthropic's
// recommended fallback model ("default" fallbacks; not offered for Haiku).
async function askClaude({ system, messages, maxTokens }) {
  const params = { model: MODEL, max_tokens: maxTokens, system, messages, output_config: { effort: EFFORT } };
  if (!/haiku/i.test(MODEL)) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
  const response = await getClient().beta.messages.create(params);
  const u = response.usage || {};
  console.log(JSON.stringify({ type: "usage", model: response.model, stop: response.stop_reason, input: u.input_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens, output: u.output_tokens }));
  if (response.stop_reason === "refusal") return { refused: true, text: "" };
  const text = (response.content || []).filter((block) => block.type === "text").map((block) => block.text).join("").trim();
  return { refused: false, text, stopReason: response.stop_reason };
}

// Turns the browser's attachment into a Claude content block. Excel and PowerPoint files are
// converted to text in the browser before upload, so they arrive here as text/plain.
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
    .map((turn) => ({ role: turn.role === "model" ? "assistant" : "user", content: turn.text.trim().slice(0, 3000) }));
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

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  const maxFileBytes = 4 * 1024 * 1024;

  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  if (!isAllowedOrigin(event)) return { statusCode: 403, headers, body: JSON.stringify({ error: "Requests are accepted only from this website." }) };

  try {
    const { message, attachment, language, quoteReady, history, audience, channel } = JSON.parse(event.body || "{}");
    // "whatsapp": the reply is shown in WhatsApp, which has no tables or headings.
    const isWhatsApp = channel === "whatsapp";
    // "worker": short, simple, step-by-step answers for site trades. "engineer": the detailed format.
    const isWorker = audience === "worker";
    if (typeof message !== "string" || !message.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: "Please enter a question." }) };
    if (message.length > 4000) return { statusCode: 400, headers, body: JSON.stringify({ error: "Please shorten your question to under 4,000 characters." }) };

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

    let attachmentPart = null;
    if (attachment) {
      if (!attachment.name || typeof attachment.mimeType !== "string" || typeof attachment.data !== "string" || !attachment.data) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Please attach a photo, PDF, Excel, PowerPoint, CSV, or TXT file." }) };
      }
      const byteLength = Buffer.byteLength(attachment.data, "base64");
      if (byteLength > maxFileBytes) return { statusCode: 413, headers, body: JSON.stringify({ error: "Please choose a document smaller than 4 MB." }) };
      attachmentPart = attachmentBlock(attachment);
      if (!attachmentPart) return { statusCode: 400, headers, body: JSON.stringify({ error: "Please attach a photo (JPEG/PNG), PDF, Excel, PowerPoint, CSV, or TXT file. If this keeps happening, refresh the page." }) };
      if (attachmentPart.tooLong) return { statusCode: 413, headers, body: JSON.stringify({ error: "This document has too much text. Please send only the sheet or pages you need help with." }) };
    }

    if (!process.env.ANTHROPIC_API_KEY && !client) {
      console.error("ANTHROPIC_API_KEY is not configured.");
      return { statusCode: 500, headers, body: JSON.stringify({ error: "The AI service has not been configured yet. Add ANTHROPIC_API_KEY in Netlify environment variables." }) };
    }

    const limited = await checkRateLimit(event);
    if (limited) return { statusCode: limited.statusCode, headers, body: JSON.stringify({ error: limited.error }) };

    // Anonymous usage log (Netlify → Functions → chat → Logs) to see what people ask.
    console.log(JSON.stringify({ type: "question", channel: isWhatsApp ? "whatsapp" : "web", language: selectedLanguage, audience: isWorker ? "worker" : "engineer", quoteReady: quoteReady === true, followUp: priorTurns.length > 0, attachment: Boolean(attachmentPart), grade: requestedGrade(message), text: message.trim().slice(0, 300) }));


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

    const quoteModeInstruction = quoteReady === true
      ? "\n\nQUOTE-READY MODE IS SELECTED. This instruction overrides the normal answer framework for construction materials, BOQs, cost, quote, budget, estimate, and rate-analysis requests. Return only this complete compact quotation, in this exact order: **Scope**, **Assumptions**, one complete itemised Markdown BOQ table, **Grand Total** (or a clear range), **Rate basis**, **Exclusions**, and **Validity / Next Step**. Do not add Recommendation, Calculation / Reasoning, teaching, alternatives, questions, or background. The BOQ table is mandatory and must contain both its header and every priced item before the reply ends. Use no more than 5 priced rows and no more than 350 words. Select the rate-column label strictly by source: if no exact CPWD entry/rate is page-verified, use **Preliminary Market Rate (₹)** as the table header, write “To be verified against applicable CPWD DSR” only in the CPWD reference column, and identify every price as a preliminary market estimate. Never use the heading “DSR Rate (₹)” for an unverified or market price. Use **CPWD DSR Base Rate (₹)** only when the exact cited CPWD entry and rate are page-verified. Never label a preliminary market rate as CPWD. Do not end immediately after a table header, and do not leave any heading, row, subtotal, or sentence unfinished."
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
      { type: "text", text: `${languageInstruction}${quoteModeInstruction}${workerInstruction}${whatsappInstruction}` }
    ];

    const isDsrRequest = /\b(boq|bill of quantities|estimate|estimation|quantity schedule|rate analysis|rate\s*analysis|cpwd|dsr)\b/i.test(message);
    const dsrContext = isDsrRequest ? `\n\n${buildCivilCatalogueContext(message)}` : "";
    const contextualGuidance = [relevantFaqContext(message), relevantDubaiRmcCostingContext(message), relevantMixDesignContext(message), relevantEngineeringReference(message)]
      .filter(Boolean).map((context) => `\n\n${context}`).join("");
    const attachmentNote = attachmentPart ? `\n\nA ${attachment.mimeType.startsWith("image/") ? "site photo" : "project document"} named "${attachment.name}" is attached. Analyze it only as needed for this request.` : "";
    // A drawing, photo or document can stay attached for follow-up questions. With earlier turns,
    // it goes into the FIRST turn and is cached, so each follow-up re-reads it at about a tenth of
    // the price instead of paying for it again. Without earlier turns it goes with this question.
    const questionText = { type: "text", text: `${message.trim()}${dsrContext}${contextualGuidance}${attachmentNote}` };
    let conversationTurns = priorTurns;
    let userContent = [...(attachmentPart ? [attachmentPart] : []), questionText];
    if (attachmentPart && priorTurns.length) {
      const [first, ...rest] = priorTurns;
      const firstText = typeof first.content === "string" ? first.content : "";
      conversationTurns = [{ role: "user", content: [{ ...attachmentPart, cache_control: { type: "ephemeral" } }, { type: "text", text: firstText }] }, ...rest];
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

    const answer = await askClaude({ system, messages: [...conversationTurns, { role: "user", content: userContent }], maxTokens: 8000 });
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
            maxTokens: 4000
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
};

module.exports = Object.assign(module.exports, { sanitizeHistory, hasCompletedQuoteTable, isIncompleteQuote, attachmentBlock, setClientForTests, setAnswerStoreForTests, MODEL });
