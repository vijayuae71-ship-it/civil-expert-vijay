"use strict";
process.env.GEMINI_API_KEY = "test-key";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeGemini, post } = require("./helpers");
const chat = require("../netlify/functions/chat");
const { relevantEngineeringReference } = require("../netlify/functions/site-engineering-reference");

const systemText = (call) => call.body.systemInstruction.parts[0].text;

test("worker mode adds simple-steps instruction; engineer mode does not", async () => {
  const calls = fakeGemini();
  await chat.handler(post({ message: "plaster ke liye kitna cement", audience: "worker" }));
  await chat.handler(post({ message: "plaster cement quantity", audience: "engineer" }));
  assert.match(systemText(calls[0]), /SIMPLE SITE-WORKER MODE/);
  assert.doesNotMatch(systemText(calls[1]), /SIMPLE SITE-WORKER MODE/);
});

test("quote-ready overrides worker mode", async () => {
  const calls = fakeGemini("**Scope**\nx");
  await chat.handler(post({ message: "quote 10 m3 M25", audience: "worker", quoteReady: true }));
  assert.doesNotMatch(systemText(calls[0]), /SIMPLE SITE-WORKER MODE/);
});

test("auto language answers in the user's language", async () => {
  const calls = fakeGemini();
  const res = await chat.handler(post({ message: "दीवार पर दरार क्यों आती है?", language: "auto" }));
  assert.equal(res.statusCode, 200);
  assert.match(systemText(calls[0]), /same language and script as the user's latest message/);
});

test("site photos are accepted and labelled as photos", async () => {
  const calls = fakeGemini();
  const res = await chat.handler(post({ message: "is this crack dangerous?", attachment: { name: "crack.jpg", mimeType: "image/jpeg", data: Buffer.from("fake").toString("base64") } }));
  assert.equal(res.statusCode, 200);
  const parts = calls[0].body.contents.at(-1).parts;
  assert.match(parts[0].text, /site photo named "crack.jpg"/);
  assert.equal(parts[1].inlineData.mimeType, "image/jpeg");
  const bad = await chat.handler(post({ message: "x", attachment: { name: "a.exe", mimeType: "application/x-msdownload", data: "AA==" } }));
  assert.equal(bad.statusCode, 400);
});

test("worker scope and safety rules are in the prompt", async () => {
  const calls = fakeGemini();
  await chat.handler(post({ message: "how to tie rebar" }));
  const sys = systemText(calls[0]);
  assert.match(sys, /Site trades and workers are fully in scope/);
  assert.match(sys, /998 ambulance/);
  assert.match(sys, /never|Never give instructions that bypass a safety rule/);
});

test("safety references match worker questions and not ordinary ones", () => {
  assert.match(relevantEngineeringReference("worker got electric shock"), /LOTO|lock out/i);
  assert.match(relevantEngineeringReference("heat stroke signs"), /12:30–15:00/);
  assert.match(relevantEngineeringReference("trench 2 m deep shoring"), /shoring/);
  assert.match(relevantEngineeringReference("cutting length of 8 mm stirrup"), /d² ÷ 162/);
  assert.equal(relevantEngineeringReference("wall height 3 m blockwork"), "");
  assert.equal(relevantEngineeringReference("current rate of cement"), "");
});
