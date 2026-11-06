"use strict";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeClaude, post } = require("./helpers");
const chat = require("../netlify/functions/chat");
const feedback = require("../netlify/functions/feedback");
const cache = require("../netlify/functions/answer-cache");

function memoryStore() {
  const data = new Map();
  return {
    data,
    get: async (k, opts) => (data.has(k) ? (opts?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null),
    setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); },
    delete: async (k) => { data.delete(k); }
  };
}

test("normalization ignores case, spaces and punctuation but keeps numbers exactly", () => {
  const n = cache.normalizeQuestion;
  assert.equal(n("How much cement for 100 sq ft plaster?"), n("  how much CEMENT for 100 sq ft plaster "));
  assert.equal(n("M25 mix, please!"), "m25 mix please");
  assert.equal(n("PCC 1:2:4"), "pcc 1:2:4");
  assert.equal(n("12.5 mm bar"), "12.5 mm bar");
  assert.equal(n("C80/95"), "c80/95");
  assert.notEqual(n("cement for 100 sq ft"), n("cement for 1000 sq ft"));
  assert.notEqual(n("M25 mix design"), n("M30 mix design"));
  assert.equal(n("दीवार पर दरार क्यों आती है?"), "दीवार पर दरार क्यों आती है"); // Indic vowel signs kept
});

test("second identical question is served from the cache without calling Claude", async () => {
  const store = memoryStore(); chat.setAnswerStoreForTests(store);
  const calls = fakeClaude(chat, "Use 1 bag cement.");
  const first = JSON.parse((await chat.handler(post({ message: "Cement for 100 sq ft plaster?", audience: "worker" }))).body);
  const second = JSON.parse((await chat.handler(post({ message: "cement for 100 sq ft plaster", audience: "worker" }))).body);
  assert.equal(calls.length, 1);
  assert.equal(second.reply, "Use 1 bag cement.");
  assert.equal(second.cached, true);
  assert.equal(first.cacheKey, second.cacheKey);
  assert.ok(cache.isCacheKey(first.cacheKey));
});

test("different numbers, language, style or quote mode are separate entries", async () => {
  const store = memoryStore(); chat.setAnswerStoreForTests(store);
  const calls = fakeClaude(chat, "answer");
  for (const body of [
    { message: "cement for 100 sq ft plaster" },
    { message: "cement for 1000 sq ft plaster" },
    { message: "cement for 100 sq ft plaster", language: "hi" },
    { message: "cement for 100 sq ft plaster", audience: "worker" },
    { message: "cement for 100 sq ft plaster", quoteReady: true }
  ]) await chat.handler(post(body));
  assert.equal(calls.length, 5 + 2); // quote mode also retried the incomplete quote twice
  assert.equal(store.data.size, 4);   // incomplete quote not saved
});

test("follow-ups, attachments, cut-off answers and refusals are never cached", async () => {
  const store = memoryStore(); chat.setAnswerStoreForTests(store);
  fakeClaude(chat, "answer");
  await chat.handler(post({ message: "and for M30?", history: [{ role: "user", text: "M25 slab" }, { role: "model", text: "..." }] }));
  await chat.handler(post({ message: "is this ok", attachment: { name: "a.jpg", mimeType: "image/jpeg", data: "AA==" } }));
  fakeClaude(chat, { stop_reason: "max_tokens", text: "half an ans" });
  await chat.handler(post({ message: "long question" }));
  fakeClaude(chat, { stop_reason: "refusal" });
  await chat.handler(post({ message: "refused question" }));
  assert.equal(store.data.size, 0);
});

test("changing the instructions or knowledge gives a different key", () => {
  const base = { model: "m", effort: "low", system: [{ text: "A" }], message: "q", context: "ctx", settings: {} };
  const k = cache.cacheKey(base);
  assert.notEqual(k, cache.cacheKey({ ...base, system: [{ text: "A edited" }] }));
  assert.notEqual(k, cache.cacheKey({ ...base, context: "ctx v2" }));
  assert.notEqual(k, cache.cacheKey({ ...base, model: "other" }));
});

test("expired entries are ignored", async () => {
  const store = memoryStore();
  await store.setJSON("k", { reply: "old", at: new Date(Date.now() - (cache.TTL_DAYS + 1) * 86400e3).toISOString() });
  assert.equal(await cache.getCachedAnswer(store, "k"), null);
  await store.setJSON("k2", { reply: "new", at: new Date().toISOString() });
  assert.equal((await cache.getCachedAnswer(store, "k2")).reply, "new");
});

test("a 👎 deletes the saved answer; 👍 keeps it", async () => {
  const store = memoryStore(); chat.setAnswerStoreForTests(store); feedback.setAnswerStoreForTests(store);
  fakeClaude(chat, "answer");
  const { cacheKey } = JSON.parse((await chat.handler(post({ message: "slope for 100 mm drain" }))).body);
  await feedback.handler(post({ vote: "up", cacheKey }));
  assert.equal(store.data.size, 1);
  await feedback.handler(post({ vote: "down", cacheKey, reason: "wrong" }));
  assert.equal(store.data.size, 0);
  assert.equal(feedback.validate({ vote: "down", cacheKey: "../../etc" }).cacheKey, null);
});

test("works without storage (Blobs unavailable) and when ANSWER_CACHE=off", async () => {
  chat.setAnswerStoreForTests(null);
  const calls = fakeClaude(chat, "answer");
  assert.equal((await chat.handler(post({ message: "q1" }))).statusCode, 200);
  assert.equal((await chat.handler(post({ message: "q1" }))).statusCode, 200);
  assert.equal(calls.length, 2);
  const store = memoryStore(); chat.setAnswerStoreForTests(store);
  process.env.ANSWER_CACHE = "off";
  await chat.handler(post({ message: "q2" })); await chat.handler(post({ message: "q2" }));
  delete process.env.ANSWER_CACHE;
  assert.equal(store.data.size, 0);
});
