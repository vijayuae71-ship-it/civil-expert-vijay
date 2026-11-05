"use strict";

// Records 👍/👎 on answers. Each vote is written to the function log and, when
// available, to the "answer-feedback" Netlify Blobs store (Netlify → Blobs) for review.
const { isAllowedOrigin, clientIp } = require("./rate-limit");

const recent = new Map(); // per-instance flood guard

function validate(body) {
  const vote = body?.vote;
  if (vote !== "up" && vote !== "down") return null;
  const clip = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  return {
    vote,
    reason: clip(body.reason, 300),
    question: clip(body.question, 1000),
    answer: clip(body.answer, 4000),
    language: clip(body.language, 10) || "en",
    quoteReady: body.quoteReady === true
  };
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  if (!isAllowedOrigin(event)) return { statusCode: 403, headers, body: JSON.stringify({ error: "Forbidden" }) };

  let entry;
  try { entry = validate(JSON.parse(event.body || "{}")); } catch { entry = null; }
  if (!entry) return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid feedback." }) };

  const ip = clientIp(event), now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < 3600e3);
  if (times.length >= 60) return { statusCode: 429, headers, body: JSON.stringify({ error: "Too many feedback submissions." }) };
  times.push(now); recent.set(ip, times);

  const record = { ...entry, at: new Date(now).toISOString() };
  console.log(JSON.stringify({ type: "feedback", vote: record.vote, reason: record.reason, question: record.question.slice(0, 300) }));
  try {
    const { getStore, connectLambda } = require("@netlify/blobs");
    if (event.blobs) connectLambda(event);
    await getStore("answer-feedback").setJSON(`${record.at.slice(0, 10)}/${now}-${Math.random().toString(36).slice(2, 8)}`, record);
  } catch (error) {
    console.error("Feedback storage unavailable:", error?.name || error);
  }
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};

exports.validate = validate;
