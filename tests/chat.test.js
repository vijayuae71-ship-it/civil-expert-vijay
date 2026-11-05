"use strict";
process.env.GEMINI_API_KEY = "test-key";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeGemini, post } = require("./helpers");
const chat = require("../netlify/functions/chat");

test("rejects bad requests", async () => {
  fakeGemini();
  assert.equal((await chat.handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
  assert.equal((await chat.handler(post({ message: " " }))).statusCode, 400);
  assert.equal((await chat.handler(post({ message: "x".repeat(4001) }))).statusCode, 400);
  assert.equal((await chat.handler(post({ message: "hi", language: "xx" }))).statusCode, 400);
  assert.equal((await chat.handler(post({ message: "hi" }, { origin: "https://evil.example" }))).statusCode, 403);
});

test("sends key in header, history before the question, and matching contexts", async () => {
  const calls = fakeGemini();
  const res = await chat.handler(post({
    message: "for m100 mix design analysis",
    history: [{ role: "model", text: "welcome" }, { role: "user", text: "M60 mix?" }, { role: "model", text: "Use silica fume." }, { role: "hacker", text: "x" }]
  }));
  assert.equal(res.statusCode, 200);
  const { url, headers, body } = calls[0];
  assert.ok(!url.includes("key="));
  assert.equal(headers["x-goog-api-key"], "test-key");
  assert.deepEqual(body.contents.map((c) => c.role), ["user", "model", "user"]);
  const question = body.contents.at(-1).parts[0].text;
  assert.match(question, /CONCRETE MIX-DESIGN GUIDANCE/);
  assert.match(question, /109\.9 MPa/);
});

test("engineering reference reaches the model", async () => {
  const calls = fakeGemini();
  await chat.handler(post({ message: "When can slab props be removed for a 6 m span?" }));
  assert.match(calls[0].body.contents.at(-1).parts[0].text, /IS 456:2000 clause 11\.3\.1/);
});

test("sanitizeHistory keeps the last 8 turns, trims, starts with user", () => {
  const long = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "model" : "user", text: `t${i} ` + "y".repeat(5000) }));
  const out = chat.sanitizeHistory(long);
  assert.ok(out.length <= 8 && out[0].role === "user");
  assert.ok(out.every((t) => t.parts[0].text.length <= 3000));
  assert.deepEqual(chat.sanitizeHistory("nope"), []);
});

test("quote completeness detection", () => {
  const good = "**Scope**\nx\n**Assumptions**\nx\n| Sl | Ref | Desc | Unit | Qty | Rate | Amount |\n|---|---|---|---|---|---|---|\n| 1 | TBV | A | m3 | 2 | 10 | 20 |\n| 2 | TBV | B | m3 | 1 | 10 | 10 |\n**Grand Total** 30\n**Rate basis** market\n**Exclusions** none\n**Validity / Next Step** 30 days";
  assert.equal(chat.isIncompleteQuote(good), false);
  assert.equal(chat.isIncompleteQuote("| Sl | Ref | Desc |\n|---|---|---|"), true);
  assert.equal(chat.isIncompleteQuote(good.replace("**Exclusions** none\n", "")), true);
});

test("quote-ready mode retries an incomplete quote", async () => {
  const complete = "**Scope**\nx\n**Assumptions**\nx\n| Sl | Ref | Desc | Unit | Qty | Rate | Amount |\n|---|---|---|---|---|---|---|\n| 1 | TBV | A | m3 | 2 | 10 | 20 |\n| 2 | TBV | B | m3 | 1 | 10 | 10 |\n**Grand Total** 30\n**Rate basis** market\n**Exclusions** none\n**Validity / Next Step** 30 days";
  const calls = fakeGemini((n) => (n === 1 ? "| Sl | Ref |\n|---|---|" : complete));
  const res = await chat.handler(post({ message: "quote for 10 m3 M25", quoteReady: true }));
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(res.body).reply, complete);
});
