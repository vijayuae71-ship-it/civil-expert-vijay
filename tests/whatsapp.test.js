"use strict";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
process.env.WHATSAPP_APP_SECRET = "test-secret";
process.env.WHATSAPP_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "12345";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { fakeClaude, systemText } = require("./helpers");
const chat = require("../netlify/functions/chat");
const wa = require("../netlify/functions/whatsapp");
const { toWhatsApp, splitMessages } = require("../netlify/functions/whatsapp-format");

function memoryStore() {
  const data = new Map();
  return { data, get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null), set: async (k, v) => { data.set(k, v); }, setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); }, delete: async (k) => { data.delete(k); } };
}
function setup() {
  const sent = [], fetches = [];
  const stores = { seen: memoryStore(), conversations: memoryStore() };
  wa.setForTests({
    stores,
    fetch: async (url, opts = {}) => {
      fetches.push({ url, opts });
      if (url.endsWith("/12345/messages")) { const body = JSON.parse(opts.body); if (body.type === "text") sent.push(body); return { ok: true, text: async () => "" }; }
      if (url.endsWith("/media-1")) return { ok: true, json: async () => ({ url: "https://lookaside.example/file", mime_type: "image/jpeg", file_size: 1000 }) };
      if (url === "https://lookaside.example/file") return { ok: true, arrayBuffer: async () => Buffer.from("jpegbytes") };
      if (url.endsWith("/media-voice")) return { ok: true, json: async () => ({ url: "x", mime_type: "audio/ogg", file_size: 10 }) };
      return { ok: false, status: 404, text: async () => "" };
    }
  });
  chat.setAnswerStoreForTests(null);
  return { sent, fetches, stores };
}
const signed = (payload) => {
  const body = JSON.stringify(payload);
  const sig = "sha256=" + crypto.createHmac("sha256", "test-secret").update(body).digest("hex");
  return { httpMethod: "POST", headers: { host: "site", "x-hub-signature-256": sig }, body };
};
const incoming = (msg) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "971500000001", id: `wamid.${Math.random()}`, timestamp: "1", ...msg }] } }] }] });

test("webhook verification", async () => {
  const ok = await wa.handler({ httpMethod: "GET", queryStringParameters: { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" } });
  assert.equal(ok.statusCode, 200); assert.equal(ok.body, "42");
  const bad = await wa.handler({ httpMethod: "GET", queryStringParameters: { "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "42" } });
  assert.equal(bad.statusCode, 403);
});

test("rejects unsigned or wrongly signed posts", async () => {
  setup();
  const body = JSON.stringify(incoming({ type: "text", text: { body: "hi" } }));
  assert.equal((await wa.handler({ httpMethod: "POST", headers: {}, body })).statusCode, 401);
  assert.equal((await wa.handler({ httpMethod: "POST", headers: { "x-hub-signature-256": "sha256=00" }, body })).statusCode, 401);
});

test("first question: welcome guide, then a WhatsApp-formatted answer; follow-up carries history", async () => {
  const { sent, stores } = setup();
  const calls = fakeClaude(chat, "## Recommendation\nUse **1 bag** cement.\n\n| Item | Qty |\n|---|---|\n| Cement | 1 bag |\n| Sand | 4 bags |");
  const res = await wa.handler(signed(incoming({ type: "text", text: { body: "Cement for 100 sq ft plaster?" } })));
  assert.equal(res.statusCode, 200);
  assert.equal(sent[0].text.body, wa.WELCOME);
  assert.equal(sent[1].to, "971500000001");
  assert.equal(sent[1].text.body, "*Recommendation*\nUse *1 bag* cement.\n\n• Cement · 1 bag\n• Sand · 4 bags");
  assert.match(systemText(calls[0]), /WHATSAPP REPLY/);
  assert.match(systemText(calls[0]), /SIMPLE SITE-WORKER MODE/);
  assert.match(systemText(calls[0]), /same language and script/);
  assert.equal([...stores.conversations.data.keys()][0].includes("971500000001"), false); // number not stored in clear

  await wa.handler(signed(incoming({ type: "text", text: { body: "and for 200 sq ft?" } })));
  assert.equal(sent.length, 3); // no second welcome
  assert.deepEqual(calls[1].messages.map((m) => m.role), ["user", "assistant", "user"]);
});

test("the same message delivered twice is answered once", async () => {
  const { sent } = setup();
  fakeClaude(chat, "answer");
  const payload = incoming({ type: "text", text: { body: "slope for drain" } });
  await wa.handler(signed(payload)); await wa.handler(signed(payload));
  assert.equal(sent.filter((m) => m.text.body === "answer").length, 1);
});

test("commands switch answer style and start fresh", async () => {
  const { sent } = setup();
  const calls = fakeClaude(chat, "answer");
  await wa.handler(signed(incoming({ type: "text", text: { body: "hi" } })));
  assert.equal(sent.at(-1).text.body, wa.WELCOME);
  await wa.handler(signed(incoming({ type: "text", text: { body: "Detailed" } })));
  await wa.handler(signed(incoming({ type: "text", text: { body: "M25 rate analysis" } })));
  assert.doesNotMatch(systemText(calls.at(-1)), /SIMPLE SITE-WORKER MODE/);
  await wa.handler(signed(incoming({ type: "text", text: { body: "new" } })));
  await wa.handler(signed(incoming({ type: "text", text: { body: "next question" } })));
  assert.equal(calls.at(-1).messages.length, 1); // history cleared
  assert.doesNotMatch(systemText(calls.at(-1)), /SIMPLE SITE-WORKER MODE/); // style kept
  assert.equal(calls.length, 2); // commands never call Claude
  assert.equal(wa.command("consult"), "consult");
});

test("a photo is downloaded and sent to Claude as an image", async () => {
  const { fetches } = setup();
  const calls = fakeClaude(chat, "Looks like honeycombing.");
  await wa.handler(signed(incoming({ type: "image", image: { id: "media-1", caption: "is this crack ok?" } })));
  const content = calls[0].messages.at(-1).content;
  assert.equal(content[0].type, "image");
  assert.equal(content[0].source.data, Buffer.from("jpegbytes").toString("base64"));
  assert.ok(fetches.some((f) => f.url === "https://lookaside.example/file" && f.opts.headers.Authorization === "Bearer test-token"));
});

test("voice notes get a helpful message without calling Claude; receipts are ignored", async () => {
  const { sent } = setup();
  const calls = fakeClaude(chat, "x");
  await wa.handler(signed(incoming({ type: "audio", audio: { id: "media-voice" } })));
  assert.match(sent.at(-1).text.body, /Voice notes are not supported yet/);
  await wa.handler(signed({ entry: [{ changes: [{ value: { statuses: [{ id: "s1", status: "delivered" }] } }] }] }));
  assert.equal(calls.length, 0);
});

test("errors from the expert are passed on politely", async () => {
  const { sent } = setup();
  chat.setClientForTests({ beta: { messages: { create: async () => { throw new Error("boom"); } } } });
  await wa.handler(signed(incoming({ type: "text", text: { body: "question" } })));
  assert.match(sent.at(-1).text.body, /Failed to connect|try again/i);
});

test("formatting and splitting", () => {
  assert.equal(toWhatsApp("**Next Step**\n- Get quotes\n[site](https://x.y)"), "*Next Step*\n• Get quotes\nsite (https://x.y)");
  const long = Array.from({ length: 300 }, (_, i) => `Line ${i} ` + "x".repeat(40)).join("\n");
  const parts = splitMessages(long);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 3800));
  assert.equal(parts.join("\n"), long);
});
