"use strict";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
process.env.ANSWER_CACHE = "off";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeClaude, systemText, post } = require("./helpers");
const chat = require("../netlify/functions/chat");
const background = require("../netlify/functions/chat-background");
const status = require("../netlify/functions/chat-status");
const start = require("../netlify/functions/chat-start");

// Page → chat-start (stores the request, starts the job) → chat-background → chat-status.
async function runJob(store, body, headers = {}) {
  let triggered = null;
  start.setForTests({ store, trigger: async (url, init) => { triggered = { url, body: JSON.parse(init.body) }; return { status: 202, ok: true }; } });
  background.setJobStoreForTests(store); status.setJobStoreForTests(store);
  const res = await start.handler(post({ jobId: JOB, ...body }, headers));
  if (res.statusCode === 202) await background.handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(triggered.body) });
  return { res, triggered };
}

function memoryStore() {
  const data = new Map();
  return {
    data,
    get: async (k, opts) => (data.has(k) ? (opts?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null),
    setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); },
    delete: async (k) => { data.delete(k); }
  };
}
const JOB = "0f8c2b1e-4a6d-4c3b-9e2f-1a2b3c4d5e6f";
const ask = (id) => status.handler({ httpMethod: "GET", headers: {}, queryStringParameters: { id } }).then((r) => JSON.parse(r.body));
chat.setAnswerStoreForTests(null);

test("background job writes a full itemised BOQ answer that the page can read once", async () => {
  const store = memoryStore(); status.setJobStoreForTests(store);
  const calls = fakeClaude(chat, "| Sl. No. | Description | Unit | Qty | Rate | Amount |\n|---|---|---|---|---|---|\n| A1 | Excavation | m³ | 95 | 280 | 26,600 |");
  assert.deepEqual(await ask(JOB), { status: "pending" });
  const { res, triggered } = await runJob(store, { message: "complete BOQ for a 1000 sq ft G+1 house", audience: "engineer", quoteReady: true });
  assert.equal(res.statusCode, 202);
  assert.equal(triggered.url, "https://constructionaiexpert.netlify.app/.netlify/functions/chat-background");
  assert.deepEqual(triggered.body, { jobId: JOB }, "only the job id goes to the background function (256 KB limit)");
  const sys = systemText(calls[0]);
  assert.match(sys, /FULL ITEMISED BOQ/);
  assert.doesNotMatch(sys, /no more than 5 priced rows/);
  assert.equal(calls[0].max_tokens, 16000);
  const job = await ask(JOB);
  assert.equal(job.status, "done");
  assert.match(job.reply, /Excavation/);
  assert.deepEqual(await ask(JOB), { status: "pending" }, "read once, then removed");
});

test("the normal quick answer keeps its limits and never gets the full-BOQ instruction", async () => {
  const calls = fakeClaude(chat, "OK.");
  await chat.handler(post({ message: "BOQ for 100 sq ft plaster", audience: "engineer", quoteReady: true }));
  const sys = systemText(calls[0]);
  assert.doesNotMatch(sys, /FULL ITEMISED BOQ/);
  assert.match(sys, /no more than 5 priced rows/);
  assert.equal(calls[0].max_tokens, 8000);
});

test("site-worker mode stays short even in the background", async () => {
  const calls = fakeClaude(chat, "Use 1 bag.");
  await runJob(memoryStore(), { message: "estimate cement for my wall", audience: "worker" });
  assert.doesNotMatch(systemText(calls[0]), /FULL ITEMISED BOQ/);
});

test("errors reach the page; bad job ids are refused", async () => {
  const store = memoryStore();
  fakeClaude(chat, "x");
  const { res } = await runJob(store, { message: "BOQ", attachments: [{ name: "a.exe", mimeType: "application/x-msdownload", data: "AA==" }] });
  assert.equal(res.statusCode, 202);
  const job = await ask(JOB);
  assert.equal(job.status, "error");
  assert.match(job.error, /attach a photo/i);
  assert.equal((await start.handler(post({ jobId: JOB, message: "" }))).statusCode, 400);
  assert.equal((await start.handler(post({ jobId: "../x", message: "BOQ" }))).statusCode, 400);
  assert.equal((await background.handler(post({ jobId: "../x" }))).statusCode, 400);
  assert.equal((await background.handler(post({ jobId: JOB }))).statusCode, 404, "a job id with no stored question does nothing");
  assert.equal((await status.handler({ queryStringParameters: { id: "nope" } })).statusCode, 400);
});

test("requests from other websites are refused in the background too", async () => {
  const calls = fakeClaude(chat, "x");
  const { res } = await runJob(memoryStore(), { message: "BOQ" }, { origin: "https://evil.example" });
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
});

test("a BOQ question with drawings: files go via the store, all reach Claude, the request is removed after use", async () => {
  const store = memoryStore();
  const calls = fakeClaude(chat, "BOQ from drawings.");
  const photo = { name: "plan.jpg", mimeType: "image/jpeg", data: Buffer.alloc(300 * 1024).toString("base64") };   // > 256 KB together
  const pdf = { name: "sections.pdf", mimeType: "application/pdf", data: Buffer.alloc(200 * 1024).toString("base64") };
  await runJob(store, { message: "BOQ from these drawings", audience: "engineer", attachments: [photo, pdf] }, { "x-nf-client-connection-ip": "1.2.3.4" });
  const content = calls[0].messages.at(-1).content;
  assert.deepEqual(content.map((b) => b.type), ["image", "document", "text"]);
  assert.match(content.at(-1).text, /2 files are attached, in this order: photo "plan.jpg"; document "sections.pdf"/);
  assert.equal(store.data.has(`req/${JOB}`), false);
  assert.equal((await ask(JOB)).status, "done");
});

test("tender tasks use their own short instruction, keep the document cached, and report a cut-off copy", async () => {
  const store = memoryStore();
  const calls = fakeClaude(chat, () => ({ text: "| Item No | Description | Unit | Qty |\n|---|---|---|---|\n| 1.1 | Soil | cum | 5 |", stop_reason: "max_tokens" }));
  const pdf = { name: "tender.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF").toString("base64") };
  await runJob(store, { task: "tender-items", message: "Copy the complete BOQ from the attached tender document.", attachments: [pdf] });
  const sys = systemText(calls[0]);
  assert.match(sys, /copy the bill of quantities/i);
  assert.doesNotMatch(sys, /FULL ITEMISED BOQ|Construction AI Expert/);
  assert.deepEqual(calls[0].messages[0].content[0].cache_control, { type: "ephemeral" });
  const job = await ask(JOB);
  assert.equal(job.status, "done");
  assert.equal(job.truncated, true);

  const rateCalls = fakeClaude(chat, "| No | Rate | Basis |\n|---|---|---|\n| 1 | 300 | x |");
  const long = "Site location: Pune.\nItems:\n" + "1. Earthwork (unit: cum, qty: 5)\n".repeat(300);   // longer than a normal question
  await runJob(memoryStore(), { task: "tender-rates", message: long });
  assert.match(systemText(rateCalls[0]), /experienced construction estimator/);
  assert.equal((await chat.handler(post({ task: "hack", message: "x" }))).statusCode, 400);
});

test("simplify, key terms and check tasks have their own instructions", async () => {
  for (const [task, re] of [["tender-simplify", /explain tender BOQ items/], ["tender-terms", /list only what matters before quoting/], ["tender-check", /check a small contractor's quotation/]]) {
    const calls = fakeClaude(chat, "✅ fine");
    const { res } = await runJob(memoryStore(), { task, message: "x".repeat(task === "tender-check" ? 40000 : 100) });
    assert.equal(res.statusCode, 202);
    assert.match(systemText(calls[0]), re, task);
  }
});

test("price lists have their own copy instruction; tender rates know about material prices", async () => {
  const calls = fakeClaude(chat, "Supplier: X\nList date: unknown\n\n| Item | Make | Size / Model | Unit | Price | Price basis |\n|---|---|---|---|---|---|\n| Cement | A | 50 kg | bag | 380 | net |");
  await runJob(memoryStore(), { task: "price-list", message: "Copy this price list.", attachments: [{ name: "list.pdf", mimeType: "application/pdf", data: "AA==" }] });
  assert.match(systemText(calls[0]), /copy a supplier's price list/);
  const rate = fakeClaude(chat, "x");
  await runJob(memoryStore(), { task: "tender-rates", message: "Items:\n1. Plaster" });
  assert.match(systemText(rate[0]), /OWN MATERIAL PRICES/);
});
