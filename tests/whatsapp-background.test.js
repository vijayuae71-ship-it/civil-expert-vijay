"use strict";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
process.env.WHATSAPP_APP_SECRET = "test-secret";
process.env.WHATSAPP_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "12345";
process.env.WHATSAPP_SLOW_NOTICE_MS = "60";
process.env.ANSWER_CACHE = "off";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const chat = require("../netlify/functions/chat");
const wa = require("../netlify/functions/whatsapp");
const bg = require("../netlify/functions/whatsapp-background");

function memoryStore() {
  const data = new Map();
  return { data, get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null), set: async (k, v) => { data.set(k, v); }, setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); }, delete: async (k) => { data.delete(k); } };
}
const signed = (payload) => {
  const body = JSON.stringify(payload);
  return { httpMethod: "POST", headers: { host: "civilengineervijay.netlify.app", "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", "test-secret").update(body).digest("hex") }, body };
};
const incoming = (text, id = `wamid.${Math.random()}`) => ({ entry: [{ changes: [{ value: { messages: [{ from: "971500000001", id, timestamp: "1", type: "text", text: { body: text } }] } }] }] });

function setup({ backgroundStatus = 202 } = {}) {
  const sent = [], triggered = [];
  const stores = { seen: memoryStore(), conversations: memoryStore(), imports: memoryStore(), jobs: memoryStore() };
  wa.setForTests({
    stores,
    fetch: async (url, opts = {}) => {
      if (url.endsWith("/.netlify/functions/whatsapp-background")) { triggered.push({ url, body: JSON.parse(opts.body) }); return { status: backgroundStatus, ok: backgroundStatus < 300, text: async () => "" }; }
      if (url.endsWith("/12345/messages")) { const b = JSON.parse(opts.body); if (b.type === "text") sent.push(b.text.body); return { ok: true, text: async () => "" }; }
      return { ok: false, status: 404, text: async () => "" };
    }
  });
  chat.setAnswerStoreForTests(null);
  return { sent, triggered, stores };
}
function claude(reply, delayMs = 0) {
  const calls = [];
  chat.setClientForTests({ beta: { messages: { create: async (params, opts) => {
    calls.push({ params, opts });
    await new Promise((r) => setTimeout(r, delayMs));
    return { model: params.model, stop_reason: "end_turn", content: [{ type: "text", text: reply }], usage: {} };
  } } } });
  return calls;
}

test("the webhook answers Meta at once and hands the message to the background job (only an id travels)", async () => {
  const { sent, triggered, stores } = setup();
  const calls = claude("Use 1 bag cement.");
  const res = await wa.handler(signed(incoming("Cement for 100 sq ft plaster?")));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 0, "no AI call inside the webhook");
  assert.equal(sent.length, 0);
  assert.equal(triggered.length, 1);
  assert.equal(triggered[0].url, "https://civilengineervijay.netlify.app/.netlify/functions/whatsapp-background");
  assert.match(triggered[0].body.id, /^[a-f0-9]{24}$/);
  assert.deepEqual(Object.keys(triggered[0].body), ["id"]);
  assert.ok(stores.jobs.data.has(`job/${triggered[0].body.id}`));

  const done = await bg.handler({ httpMethod: "POST", headers: { host: "civilengineervijay.netlify.app" }, body: JSON.stringify(triggered[0].body) });
  assert.equal(done.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].opts?.timeout >= 60000, "the background answer may take longer than a webhook");
  assert.ok(sent.some((t) => /1 bag cement/.test(t)), "the answer is sent");
  assert.equal(stores.jobs.data.size, 0, "the job is removed");
  assert.equal((await bg.handler({ body: JSON.stringify(triggered[0].body) })).statusCode, 404, "a job runs once");
});

test("a slow answer gets one '⏳ Working on your answer' message, never a stream of updates", async () => {
  const { sent, triggered } = setup();
  claude("Here is your full BOQ.", 200);
  await wa.handler(signed(incoming("detailed")));      // a command: answered by the job too
  await wa.handler(signed(incoming("Full BOQ for a 1000 sq ft house")));
  await bg.handler({ body: JSON.stringify(triggered[1].body) });
  const notices = sent.filter((t) => /Working on your answer/.test(t));
  assert.equal(notices.length, 1);
  assert.ok(sent.indexOf(notices[0]) < sent.findIndex((t) => /full BOQ/.test(t)), "the notice comes before the answer");
});

test("a quick answer gets no notice", async () => {
  const { sent, triggered } = setup();
  claude("Yes.", 0);
  await wa.handler(signed(incoming("Is M25 ok for a slab?")));
  await bg.handler({ body: JSON.stringify(triggered[0].body) });
  assert.equal(sent.filter((t) => /Working on your answer/.test(t)).length, 0);
});

test("if the background job can't start, the message is answered in the webhook as before", async () => {
  const { sent, stores } = setup({ backgroundStatus: 500 });
  const calls = claude("Answered inline.");
  await wa.handler(signed(incoming("Cement for 100 sq ft plaster?")));
  assert.equal(calls.length, 1);
  assert.ok(sent.some((t) => /Answered inline/.test(t)));
  assert.equal(stores.jobs.data.size, 0, "the unused job is cleaned up");
});

test("the background function only runs stored jobs", async () => {
  setup();
  const calls = claude("x");
  assert.equal((await bg.handler({ body: JSON.stringify({ id: "../../x" }) })).statusCode, 400);
  assert.equal((await bg.handler({ body: JSON.stringify({ id: "a".repeat(24) }) })).statusCode, 404);
  assert.equal((await bg.handler({ body: JSON.stringify({ msg: { from: "911234567890", type: "text", text: { body: "spam" } } }) })).statusCode, 400, "a made-up message can't be sent through it");
  assert.equal(calls.length, 0);
});
