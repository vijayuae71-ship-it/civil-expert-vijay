"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { post } = require("./helpers");
const feedback = require("../netlify/functions/feedback");

test("validates votes and clips long fields", () => {
  assert.equal(feedback.validate({ vote: "maybe" }), null);
  const v = feedback.validate({ vote: "down", reason: "r".repeat(999), answer: "a".repeat(9999) });
  assert.equal(v.reason.length, 300);
  assert.equal(v.answer.length, 4000);
});

test("handler accepts a vote even when Blobs is unavailable", async () => {
  const res = await feedback.handler(post({ vote: "up", question: "q", answer: "a" }));
  assert.equal(res.statusCode, 200);
  assert.equal((await feedback.handler(post({ vote: "x" }))).statusCode, 400);
  assert.equal((await feedback.handler(post({ vote: "up" }, { origin: "https://evil.example" }))).statusCode, 403);
});
