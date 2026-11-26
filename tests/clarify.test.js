"use strict";
// Ask before answering: the AI's question block, the website card's answer text and the WhatsApp version.
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
process.env.WHATSAPP_APP_SECRET = "test-secret";
process.env.WHATSAPP_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "12345";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const C = require("../assets/clarify.js");
const { fakeClaude, systemText } = require("./helpers");
const chat = require("../netlify/functions/chat");
const wa = require("../netlify/functions/whatsapp");

const ASK = "[[ASK]]\nTo give you an accurate BOQ:\n1. Where is the site? | Bengaluru | Mysuru | Dubai | Other\n2. **Built-up area?** | 600 sq ft | 1000 sq ft | 1500 sq ft\n3. How many floors? | G | G+1 | G+2";

test("the question block is read into questions with options; anything else is an answer", () => {
  const a = C.parse(ASK);
  assert.equal(a.intro, "To give you an accurate BOQ:");
  assert.deepEqual(a.questions.map((q) => q.q), ["Where is the site?", "Built-up area?", "How many floors?"]);
  assert.deepEqual(a.questions[0].options, ["Bengaluru", "Mysuru", "Dubai", "Other"]);
  assert.equal(C.parse("## Recommendation\nUse 1 bag."), null);
  assert.equal(C.parse("[[ASK]]\nno numbered questions here"), null);
  assert.equal(C.parse("Use [[ASK]] later"), null, "only at the start");
  assert.equal(C.parse("[[ASK]]\n- Which grade? | M20 | M25").questions[0].q, "Which grade?");
});

test("answers go back as one message; unanswered ones ask the AI to assume", () => {
  const a = C.parse(ASK);
  assert.equal(C.answerText(a, ["Mysuru", "1000 sq ft", ""]), "My answers:\n1. Where is the site: Mysuru\n2. Built-up area: 1000 sq ft\n3. How many floors: not sure — please assume");
  const w = C.whatsappText(a);
  assert.match(w, /^To give you an accurate BOQ:/);
  assert.match(w, /\*1\. Where is the site\?\*\n   Bengaluru \/ Mysuru \/ Dubai \/ Other/);
  assert.match(w, /send \*quick\* for a quick estimate/);
  assert.doesNotMatch(w, /\[\[ASK\]\]|\|/);
});

test("the AI is told to ask before answering, and a question block is never 'repaired' into a quotation", async () => {
  chat.setAnswerStoreForTests(null);
  const post = (body) => chat.handler({ httpMethod: "POST", headers: { host: "site", "x-nf-client-connection-ip": "8.8.4.4" }, body: JSON.stringify(body) });
  const calls = fakeClaude(chat, ASK);
  const res = await post({ message: "BOQ for a house", audience: "engineer", quoteReady: true });
  assert.equal(calls.length, 1, "no repair call for a question block");
  assert.equal(JSON.parse(res.body).reply, ASK);
  const sys = systemText(calls[0]);
  assert.match(sys, /ASK BEFORE ANSWERING/);
  assert.match(sys, /your previous reply in this conversation was already a \[\[ASK\]\] block — then answer now/);
  assert.match(sys, /Exception: if details that change the quotation materially are missing/);
});

test("WhatsApp: a question block is sent as numbered questions; the reply with answers goes to the AI with the history", async () => {
  const sent = [], conversations = new Map();
  const mem = (data) => ({ get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null), set: async (k, v) => { data.set(k, v); }, setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); } });
  wa.setForTests({ stores: { seen: mem(new Map()), conversations: mem(conversations) }, fetch: async (url, opts = {}) => { if (url.endsWith("/12345/messages")) { const b = JSON.parse(opts.body); if (b.type === "text") sent.push(b.text.body); } return { ok: true, text: async () => "", json: async () => ({}) }; } });
  chat.setAnswerStoreForTests(null);
  const signed = (text) => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "971500000077", id: `wamid.${Math.random()}`, timestamp: "1", type: "text", text: { body: text } }] } }] }] });
    return { httpMethod: "POST", headers: { host: "site", "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", "test-secret").update(body).digest("hex") }, body };
  };
  fakeClaude(chat, ASK);
  await wa.handler(signed("Cost of building a house?"));
  const last = sent.at(-1);
  assert.match(last, /\*1\. Where is the site\?\*/); assert.doesNotMatch(last, /\[\[ASK\]\]/);
  const calls = fakeClaude(chat, "## Recommendation\nAbout ₹20 lakh.");
  await wa.handler(signed("Mysuru, 1000 sq ft, G+1"));
  const msgs = calls[0].messages;
  assert.ok(msgs.some((m) => m.role === "assistant" && JSON.stringify(m.content).includes("[[ASK]]")), "the AI sees its own questions");
  assert.match(sent.at(-1), /20 lakh/);
});
