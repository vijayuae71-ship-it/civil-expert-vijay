"use strict";
// Growth: where users come from, the "Made with" links, the trade pages and WhatsApp trade links.
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
process.env.WHATSAPP_APP_SECRET = "test-secret";
process.env.WHATSAPP_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "12345";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const G = require("../assets/growth.js");
const usage = require("../netlify/functions/usage-stats");
const visit = require("../netlify/functions/visit");
const T = require("../netlify/functions/trades");
const { fakeClaude, systemText } = require("./helpers");
const chat = require("../netlify/functions/chat");
const wa = require("../netlify/functions/whatsapp");
const root = path.join(__dirname, "..");

function memoryStore() {
  const data = new Map();
  return { data, get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null), set: async (k, v) => { data.set(k, v); }, setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); }, delete: async (k) => { data.delete(k); }, list: async ({ prefix = "" } = {}) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }) };
}

test("source of a visit: tagged links first, then the sending site; own site and none are empty", () => {
  assert.equal(G.sourceOf("?r=pdf-snag", "", "x"), "pdf-snag");
  assert.equal(G.sourceOf("?utm_source=Plumbers WhatsApp Group", "", "x"), "plumbers-whatsapp-group");
  assert.equal(G.sourceOf("", "https://www.google.co.in/", "x"), "google");
  assert.equal(G.sourceOf("", "https://l.instagram.com/?u=1", "x"), "facebook-instagram");
  assert.equal(G.sourceOf("", "https://youtu.be/abc", "x"), "youtube");
  assert.equal(G.sourceOf("", "https://civilforum.example/post", "x"), "site-civilforum.example");
  assert.equal(G.sourceOf("", "https://mysite.app/expert", "mysite.app"), "");
  assert.equal(G.sourceOf("", "", "x"), "");
  assert.equal(G.pageOf("/for/plumber"), "for-plumber"); assert.equal(G.pageOf("/"), "home"); assert.equal(G.pageOf("/expert.html"), "expert");
});

test("made-with line and share message carry a tagged link; share text in the person's language", () => {
  assert.equal(G.link("pdf-ai"), "https://civilengineervijay.netlify.app/?r=pdf-ai");
  assert.equal(G.madeWith("wa-snag"), "Made with Sahi Nirman (sahi jawab · sahi rate · sahi delivery) · civilengineervijay.netlify.app/?r=wa-snag");
  assert.match(G.shareText("kn"), /^Sahi Nirman ಬಳಸಿ ನೋಡಿ[^\n]*\nhttps:\/\/civilengineervijay\.netlify\.app\/\?r=share$/);
  assert.match(G.shareText("xx"), /^Try Sahi Nirman/);
  for (const lang of ["en", "hi", "ur", "ar", "ml", "ta", "bn", "kn", "mr", "te", "pa"]) assert.ok(G.MSG[lang], lang);
});

test("visit records: browser requests only, a valid device code, cleaned source; counted once per device per day", async () => {
  const store = memoryStore(); usage.setStoreForTests(store);
  const post = (body, origin = "https://site") => visit.handler({ httpMethod: "POST", headers: { host: "site", origin }, body: JSON.stringify(body) });
  assert.equal((await post({ vid: "a".repeat(24), isNew: true, ref: "PDF snag!", page: "for-plumber" })).statusCode, 204);
  assert.equal((await visit.handler({ httpMethod: "POST", headers: { host: "site" }, body: JSON.stringify({ vid: "b".repeat(24) }) })).statusCode, 403, "no Origin: not counted");
  assert.equal((await post({ vid: "b".repeat(24) }, "https://evil.example")).statusCode, 403);
  assert.equal((await post({ vid: "not-hex" })).statusCode, 400);
  assert.equal((await visit.handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
  await post({ vid: "a".repeat(24), isNew: false, ref: "pdf-snag", page: "expert" });   // same device again the same day
  await post({ vid: "c".repeat(24), isNew: false, ref: "google", page: "expert", via: "wa-snag" });
  const events = await Promise.all([...store.data.keys()].map((k) => store.get(k, { type: "json" })));
  assert.deepEqual(events.find((e) => e.isNew).ref, "pdf-snag");
  const v = usage.summarize(events).visitors;
  assert.deepEqual({ devices: v.devices, new: v.new, returning: v.returning, sources: v.sources, via: v.returningVia }, { devices: 2, new: 1, returning: 1, sources: { "pdf-snag": 1 }, via: { "wa-snag": 1 } });
  assert.ok(!JSON.stringify(usage.summarize(events)).includes("aaaa"), "the summary keeps no device codes");
  usage.setStoreForTests(undefined);
});

test("trade links: each WhatsApp greeting is recognised, ordinary questions are not", () => {
  for (const t of T.TRADES) assert.equal(T.tradeFromIntro(T.waText(t))?.slug, t.slug, T.waText(t));
  assert.equal(T.waText(T.tradeFor("electrician")), "Hi! I am an electrician ⚡");
  assert.equal(T.tradeFromIntro("I'm a plumber")?.slug, "plumber");
  assert.equal(T.tradeFromIntro("How much paint for a 12 x 10 room?"), null);
  assert.equal(T.tradeFromIntro("I am a painter and I want to know how much paint is needed for a 3 bedroom flat with ceilings"), null, "a long question is a question");
  assert.equal(T.tradeFor("PLUMBER").slug, "plumber"); assert.equal(T.tradeFor("hacker"), null);
  assert.match(T.tradeInstruction(T.tradeFor("plumber")), /The person asking is a plumber/); assert.equal(T.tradeInstruction(null), "");
});

test("the AI is told the person's trade; unknown trades are ignored", async () => {
  chat.setAnswerStoreForTests(null);
  const post = (body) => chat.handler({ httpMethod: "POST", headers: { host: "site", "x-nf-client-connection-ip": "9.9.9.9" }, body: JSON.stringify(body) });
  let calls = fakeClaude(chat, "Use 20 mm pipes.");
  await post({ message: "Pipe size for a kitchen sink?", trade: "plumber" });
  assert.match(systemText(calls[0]), /The person asking is a plumber/);
  calls = fakeClaude(chat, "OK.");
  await post({ message: "Pipe size for a kitchen sink?", trade: "<script>" });
  assert.doesNotMatch(systemText(calls[0]), /The person asking is/);
});

test("WhatsApp: a trade link's first message gets that trade's welcome and page; later answers know the trade", async () => {
  const sent = [], stores = { seen: memoryStore(), conversations: memoryStore() };
  wa.setForTests({ stores, fetch: async (url, opts = {}) => { if (url.endsWith("/12345/messages")) { const b = JSON.parse(opts.body); if (b.type === "text") sent.push(b.text.body); } return { ok: true, text: async () => "", json: async () => ({}) }; } });
  chat.setAnswerStoreForTests(null);
  const signed = (text) => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "971500000009", id: `wamid.${Math.random()}`, timestamp: "1", type: "text", text: { body: text } }] } }] }] });
    return { httpMethod: "POST", headers: { host: "site", "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", "test-secret").update(body).digest("hex") }, body };
  };
  const none = fakeClaude(chat, "should not be called");
  await wa.handler(signed("Hi! I am a plumber 🔧"));
  assert.equal(none.length, 0, "the greeting is not sent to the AI");
  assert.match(sent.join("\n"), /Welcome, plumber!/);
  assert.match(sent.join("\n"), /\/for\/plumber\?r=wa-bot/);
  const calls = fakeClaude(chat, "Use 25 mm PPR for the main line.");
  await wa.handler(signed("Pipe size for the main line of a 2-storey house?"));
  assert.match(systemText(calls[0]), /The person asking is a plumber/);
  assert.match(sent.at(-1), /25 mm PPR/);
  await wa.handler(signed("new"));
  const again = fakeClaude(chat, "OK.");
  await wa.handler(signed("And for the hot water line?"));
  assert.match(systemText(again[0]), /The person asking is a plumber/, "'new' keeps the trade");
});

test("trade pages are built from the trade list and up to date; every page tracks visits", () => {
  const { build, CONTENT } = require("../scripts/build-trade-pages.js");
  const files = build();
  assert.equal(Object.keys(files).length, T.TRADES.length + 1);
  for (const [name, html] of Object.entries(files)) {
    assert.equal(fs.readFileSync(path.join(root, "for", name), "utf8"), html, `for/${name} is out of date — run node scripts/build-trade-pages.js`);
    assert.match(html, /\/assets\/growth\.js/);
  }
  for (const t of T.TRADES) {
    const html = files[`${t.slug}.html`];
    assert.match(html, new RegExp(`<link rel="canonical" href="https://civilengineervijay\\.netlify\\.app/for/${t.slug}">`));
    assert.ok(html.includes(`data-wa-text="${T.waText(t).replace(/&/g, "&amp;")}"`), t.slug);
    assert.equal((html.match(/\/expert\?trade=/g) || []).length, CONTENT[t.slug].questions.length + 1);
  }
  for (const page of fs.readdirSync(root).filter((f) => f.endsWith(".html") && f !== "owner.html")) assert.match(fs.readFileSync(path.join(root, page), "utf8"), /assets\/growth\.js/, page);
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  for (const t of T.TRADES) assert.match(sitemap, new RegExp(`/for/${t.slug}<`));
});
