"use strict";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
process.env.ANSWER_CACHE = "off";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeClaude, post } = require("./helpers");
const chat = require("../netlify/functions/chat");
const usage = require("../netlify/functions/usage-stats");
const owner = require("../netlify/functions/owner-stats");

function memoryStore() {
  const data = new Map();
  return {
    data,
    get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null),
    setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); },
    delete: async (k) => { data.delete(k); },
    list: async ({ prefix }) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) })
  };
}
const ask = (headers = {}, days = 7) => owner.handler({ httpMethod: "GET", headers, queryStringParameters: { days: String(days) } });

test("AI cost estimate per model, including cache reads/writes and Haiku's long-prompt price", () => {
  assert.equal(usage.callCost({ model: "claude-opus-5-5", input: 1e6, output: 1e6 }), 24);
  assert.equal(usage.callCost({ model: "claude-haiku-5-5", input: 1000, output: 1000, cacheWrite: 8000 }), (1000 * 0.1 + 1000 * 0.5 + 8000 * 0.125) / 1e6);
  assert.equal(usage.callCost({ model: "claude-haiku-5-5", input: 150000, output: 0 }), 150000 * 0.5 / 1e6);
  assert.equal(usage.callCost({ model: "claude-opus-5-5", cacheRead: 1e6 }), 0.2);
});

test("each question leaves one anonymous record with its AI calls; rejected requests leave none", async () => {
  const store = memoryStore(); usage.setStoreForTests(store); chat.setAnswerStoreForTests(null);
  fakeClaude(chat, "Use 1 bag.");
  await chat.handler(post({ message: "Cement for 100 sq ft plaster?", audience: "worker", language: "hi" }));
  await chat.handler(post({ message: "x" }, { origin: "https://evil.example" }));
  await chat.handler(post({ message: "" }));
  const recs = [...store.data.values()].map((v) => JSON.parse(v));
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.deepEqual([r.kind, r.channel, r.audience, r.language, r.status, r.q], ["chat", "web", "worker", "hi", 200, "Cement for 100 sq ft plaster?"]);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].model, chat.MODEL);
  assert.ok(!JSON.stringify(r).includes("x-nf-client-connection-ip"));
  const s = usage.summarize(recs);
  assert.equal(s.questions, 1); assert.deepEqual(s.languages, { hi: 1 });
  assert.ok(s.cost > 0);
});

test("owner page data: needs the key; summarises days, rolls past days up and deletes their raw records", async () => {
  delete process.env.OWNER_KEY;
  assert.equal((await ask()).statusCode, 503);
  process.env.OWNER_KEY = "correct-horse-battery";
  assert.equal((await ask({ "x-owner-key": "wrong" })).statusCode, 401);
  const store = memoryStore(), fb = memoryStore(); usage.setStoreForTests(store); owner.setFeedbackStoreForTests(fb);
  const today = usage.dayOf(), yday = usage.dayOf(Date.now() - 864e5);
  const ev = (day, i, e) => store.setJSON(`ev/${day}/${i}`, { at: Date.parse(day) + i, kind: "chat", channel: "web", audience: "worker", language: "en", status: 200, calls: [{ model: "claude-opus-5-5", input: 1000, output: 500, cacheRead: 0, cacheWrite: 0 }], ...e });
  await ev(yday, 1, { q: "old question" }); await ev(yday, 2, { cached: true, calls: [] }); await ev(yday, 3, { task: "tender-items", calls: [{ model: "claude-haiku-5-5", input: 10, output: 100, cacheRead: 0, cacheWrite: 0 }] });
  await ev(today, 1, { q: "How deep is a footing?", channel: "whatsapp" });
  await store.setJSON(`ev/${today}/9`, { at: Date.now(), kind: "wa-import", importKind: "prices" });
  await fb.setJSON(`${today}/1`, { vote: "down", question: "Q1", reason: "rate too low", at: `${today}T10:00:00Z` });
  await fb.setJSON(`${today}/2`, { vote: "up", at: `${today}T11:00:00Z` });
  const res = await ask({ "x-owner-key": "correct-horse-battery" }, 2);
  assert.equal(res.statusCode, 200);
  const { days } = JSON.parse(res.body);
  assert.deepEqual(days.map((d) => d.day), [yday, today]);
  assert.deepEqual([days[0].questions, days[0].cached, days[0].tasks], [2, 1, { "tender-items": 1 }]);
  assert.equal(days[1].channels.whatsapp, 1);
  assert.deepEqual(days[1].waImports, { prices: 1 });
  assert.deepEqual([days[1].feedback.up, days[1].feedback.down, days[1].feedback.downs[0].reason], [1, 1, "rate too low"]);
  assert.deepEqual(days[1].recent.map((r) => r.q), ["How deep is a footing?"]);
  assert.ok(store.data.has(`sum/${yday}`), "yesterday is kept as a summary");
  assert.equal([...store.data.keys()].filter((k) => k.startsWith(`ev/${yday}/`)).length, 0, "and its raw records are deleted");
  assert.ok([...store.data.keys()].some((k) => k.startsWith(`ev/${today}/`)), "today stays raw");
  const again = JSON.parse((await ask({ "x-owner-key": "correct-horse-battery" }, 2)).body);
  assert.equal(again.days[0].questions, 2, "the summary is read back");
  usage.setStoreForTests(undefined);
});
