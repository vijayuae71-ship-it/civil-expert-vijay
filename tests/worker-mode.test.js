"use strict";
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fakeClaude, systemText: sys, lastUserText, post } = require("./helpers");
const chat = require("../netlify/functions/chat");
const { relevantEngineeringReference } = require("../netlify/functions/site-engineering-reference");

const systemText = sys;

test("worker mode adds simple-steps instruction; engineer mode does not", async () => {
  const calls = fakeClaude(chat);
  await chat.handler(post({ message: "plaster ke liye kitna cement", audience: "worker" }));
  await chat.handler(post({ message: "plaster cement quantity", audience: "engineer" }));
  assert.match(systemText(calls[0]), /SIMPLE SITE-WORKER MODE/);
  assert.doesNotMatch(systemText(calls[1]), /SIMPLE SITE-WORKER MODE/);
});

test("quote-ready overrides worker mode", async () => {
  const calls = fakeClaude(chat, "**Scope**\nx");
  await chat.handler(post({ message: "quote 10 m3 M25", audience: "worker", quoteReady: true }));
  assert.doesNotMatch(systemText(calls[0]), /SIMPLE SITE-WORKER MODE/);
});

test("auto language answers in the user's language", async () => {
  const calls = fakeClaude(chat);
  const res = await chat.handler(post({ message: "दीवार पर दरार क्यों आती है?", language: "auto" }));
  assert.equal(res.statusCode, 200);
  assert.match(systemText(calls[0]), /same language and script as the user's latest message/);
});

test("site photos are accepted and labelled as photos", async () => {
  const calls = fakeClaude(chat);
  const res = await chat.handler(post({ message: "is this crack dangerous?", attachment: { name: "crack.jpg", mimeType: "image/jpeg", data: Buffer.from("fake").toString("base64") } }));
  assert.equal(res.statusCode, 200);
  const content = calls[0].messages.at(-1).content;
  assert.equal(content[0].type, "image");
  assert.equal(content[0].source.media_type, "image/jpeg");
  assert.match(lastUserText(calls[0]), /site photo named "crack.jpg"/);
  const bad = await chat.handler(post({ message: "x", attachment: { name: "a.exe", mimeType: "application/x-msdownload", data: "AA==" } }));
  assert.equal(bad.statusCode, 400);
});

test("worker scope and safety rules are in the prompt", async () => {
  const calls = fakeClaude(chat);
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

test("fire alarm reference gives the 1 m diffuser clearance and matches detector questions", () => {
  const ref = relevantEngineeringReference("smoke detector spacing near AC diffuser");
  assert.match(ref, /not within 1 m/);
  assert.match(ref, /3 ft \(0\.9 m\)/);
  assert.equal(relevantEngineeringReference("concrete slab smoke from welding"), "");
});

test("prompt asks for UAE/India side by side when location is missing", async () => {
  const calls = fakeClaude(chat);
  await chat.handler(post({ message: "water demand per person" }));
  assert.match(systemText(calls[0]), /both the UAE and India/);
});
