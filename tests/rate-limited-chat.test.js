"use strict";
process.env.GEMINI_API_KEY = "test-key";
process.env.CHAT_LIMIT_PER_IP_HOUR = "2";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeGemini, post } = require("./helpers");
const chat = require("../netlify/functions/chat");

test("chat returns 429 once a visitor passes the hourly limit, without calling Gemini", async () => {
  const calls = fakeGemini();
  const ip = { "x-nf-client-connection-ip": "9.9.9.9" };
  assert.equal((await chat.handler(post({ message: "q1" }, ip))).statusCode, 200);
  assert.equal((await chat.handler(post({ message: "q2" }, ip))).statusCode, 200);
  const third = await chat.handler(post({ message: "q3" }, ip));
  assert.equal(third.statusCode, 429);
  assert.equal(calls.length, 2);
});
