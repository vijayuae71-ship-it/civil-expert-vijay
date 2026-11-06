"use strict";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
const test = require("node:test");
const assert = require("node:assert/strict");
const Anthropic = require("@anthropic-ai/sdk").default;
const { fakeClaude, systemText, lastUserText, post } = require("./helpers");
const chat = require("../netlify/functions/chat");

const COMPLETE_QUOTE = "**Scope**\nx\n**Assumptions**\nx\n| Sl | Ref | Desc | Unit | Qty | Rate | Amount |\n|---|---|---|---|---|---|---|\n| 1 | TBV | A | m3 | 2 | 10 | 20 |\n| 2 | TBV | B | m3 | 1 | 10 | 10 |\n**Grand Total** 30\n**Rate basis** market\n**Exclusions** none\n**Validity / Next Step** 30 days";

test("rejects bad requests", async () => {
  fakeClaude(chat);
  assert.equal((await chat.handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
  assert.equal((await chat.handler(post({ message: " " }))).statusCode, 400);
  assert.equal((await chat.handler(post({ message: "x".repeat(4001) }))).statusCode, 400);
  assert.equal((await chat.handler(post({ message: "hi", language: "xx" }))).statusCode, 400);
  assert.equal((await chat.handler(post({ message: "hi" }, { origin: "https://evil.example" }))).statusCode, 403);
});

test("calls Claude with model, effort, fallbacks, cached system prompt and history", async () => {
  const calls = fakeClaude(chat);
  const res = await chat.handler(post({
    message: "for m100 mix design analysis",
    history: [{ role: "model", text: "welcome" }, { role: "user", text: "M60 mix?" }, { role: "model", text: "Use silica fume." }, { role: "hacker", text: "x" }]
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).reply, "**Recommendation**\nOK.");
  const p = calls[0];
  assert.equal(p.model, "claude-opus-5-5");
  assert.deepEqual(p.output_config, { effort: "low" });
  assert.deepEqual(p.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(p.fallbacks, "default");
  assert.equal(p.temperature, undefined);
  assert.deepEqual(p.system[0].cache_control, { type: "ephemeral" });
  assert.doesNotMatch(p.system[0].text, /SIMPLE SITE-WORKER MODE|Answer in English/); // per-request parts stay out of the cached block
  assert.deepEqual(p.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.match(lastUserText(p), /CONCRETE MIX-DESIGN GUIDANCE/);
  assert.match(lastUserText(p), /109\.9 MPa/);
});

test("the cached system block is identical across visitors and settings", async () => {
  const calls = fakeClaude(chat);
  await chat.handler(post({ message: "a", language: "hi", audience: "worker" }));
  await chat.handler(post({ message: "b", language: "en", audience: "engineer", quoteReady: true }));
  assert.equal(calls[0].system[0].text, calls[1].system[0].text);
  assert.notEqual(calls[0].system[1].text, calls[1].system[1].text);
});

test("engineering reference reaches the model", async () => {
  const calls = fakeClaude(chat);
  await chat.handler(post({ message: "When can slab props be removed for a 6 m span?" }));
  assert.match(lastUserText(calls[0]), /IS 456:2000 clause 11\.3\.1/);
});

test("a refusal returns a polite message, not an error", async () => {
  fakeClaude(chat, { stop_reason: "refusal" });
  const res = await chat.handler(post({ message: "something" }));
  assert.equal(res.statusCode, 200);
  assert.match(JSON.parse(res.body).reply, /construction or site-work question/);
});

test("API errors map to friendly messages", async () => {
  const cases = [
    [new Anthropic.RateLimitError(429, {}, "rate", new Headers()), 429],
    [new Anthropic.AuthenticationError(401, {}, "auth", new Headers()), 500],
    [new Anthropic.InternalServerError(529, {}, "overloaded", new Headers()), 503],
    [new Anthropic.APIConnectionTimeoutError(), 504]
  ];
  for (const [err, status] of cases) {
    chat.setClientForTests({ beta: { messages: { create: async () => { throw err; } } } });
    const res = await chat.handler(post({ message: "q" }));
    assert.equal(res.statusCode, status, err.constructor.name);
    assert.ok(JSON.parse(res.body).error);
  }
});

test("attachments become Claude content blocks", () => {
  const b64 = (s) => Buffer.from(s).toString("base64");
  assert.equal(chat.attachmentBlock({ name: "a.jpg", mimeType: "image/jpeg", data: "AA==" }).type, "image");
  const pdf = chat.attachmentBlock({ name: "a.pdf", mimeType: "application/pdf", data: "AA==" });
  assert.equal(pdf.type, "document"); assert.equal(pdf.source.media_type, "application/pdf");
  const csv = chat.attachmentBlock({ name: "boq.xlsx (converted)", mimeType: "text/plain", data: b64("Item,Qty\nPCC,10") });
  assert.deepEqual(csv.source, { type: "text", media_type: "text/plain", data: "Item,Qty\nPCC,10" });
  assert.equal(chat.attachmentBlock({ name: "a.xlsx", mimeType: "application/vnd.ms-excel", data: "AA==" }), null);
  assert.equal(chat.attachmentBlock({ name: "a.heic", mimeType: "image/heic", data: "AA==" }), null);
  assert.ok(chat.attachmentBlock({ name: "big.txt", mimeType: "text/plain", data: b64("x".repeat(300001)) }).tooLong);
});

test("sanitizeHistory keeps the last 8 turns, trims, maps roles, starts with user", () => {
  const long = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "model" : "user", text: `t${i} ` + "y".repeat(5000) }));
  const out = chat.sanitizeHistory(long);
  assert.ok(out.length <= 8 && out[0].role === "user");
  assert.ok(out.every((t) => (t.role === "user" || t.role === "assistant") && t.content.length <= 3000));
  assert.deepEqual(chat.sanitizeHistory("nope"), []);
});

test("quote completeness detection", () => {
  assert.equal(chat.isIncompleteQuote(COMPLETE_QUOTE), false);
  assert.equal(chat.isIncompleteQuote("| Sl | Ref | Desc |\n|---|---|---|"), true);
  assert.equal(chat.isIncompleteQuote(COMPLETE_QUOTE.replace("**Exclusions** none\n", "")), true);
});

test("quote-ready mode retries an incomplete quote", async () => {
  const calls = fakeClaude(chat, (n) => (n === 1 ? "| Sl | Ref |\n|---|---|" : COMPLETE_QUOTE));
  const res = await chat.handler(post({ message: "quote for 10 m3 M25", quoteReady: true }));
  assert.equal(calls.length, 2);
  assert.equal(typeof calls[1].system, "string");
  assert.equal(JSON.parse(res.body).reply, COMPLETE_QUOTE);
});

test("an attachment kept for follow-ups goes into the first turn, cached; a first question carries it itself", async () => {
  const calls = fakeClaude(chat);
  const attachment = { name: "slab.jpg", mimeType: "image/jpeg", data: "AA==" };
  await chat.handler(post({ message: "What is the slab thickness?", attachment }));
  let msgs = calls[0].messages;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].content[0].type, "image");
  assert.equal(msgs[0].content[0].cache_control, undefined);

  await chat.handler(post({ message: "How much concrete for it?", attachment, history: [{ role: "user", text: "What is the slab thickness?\n\n[Attached: slab.jpg]" }, { role: "model", text: "150 mm." }] }));
  msgs = calls[1].messages;
  assert.deepEqual(msgs.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(msgs[0].content[0].type, "image");
  assert.deepEqual(msgs[0].content[0].cache_control, { type: "ephemeral" });
  assert.match(msgs[0].content[1].text, /slab thickness/);
  assert.ok(msgs[2].content.every((b) => b.type === "text"));
  assert.match(lastUserText(calls[1]), /How much concrete/);
  assert.match(systemText(calls[1]), /drawing, plan, section, schedule, product photo/);
});

test("attachments come with today's date so expiry dates can be judged", async () => {
  const calls = fakeClaude(chat);
  await chat.handler(post({ message: "Can I use this?", attachment: { name: "label.jpg", mimeType: "image/jpeg", data: "AA==" } }));
  assert.match(lastUserText(calls[0]), new RegExp(`Today's date is ${new Date().toISOString().slice(0, 10)}`));
  await chat.handler(post({ message: "no attachment here" }));
  assert.doesNotMatch(lastUserText(calls[1]), /Today's date is/); // keeps saved answers reusable
});
