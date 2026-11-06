"use strict";

// Saved answers for repeat questions, so the same question costs no Claude tokens.
//
// Only reused when it is safe: a first question (no earlier conversation), no attachment,
// and the SAME tidied wording with the SAME numbers, language, answer style and model.
// The key also includes the exact instructions and reference material sent to Claude,
// so editing the prompt or any knowledge file automatically starts a fresh cache.
// A 👎 on an answer deletes it (see feedback.js). Entries expire after ANSWER_CACHE_TTL_DAYS.
//
// Storage: Netlify Blobs store "answer-cache". Set ANSWER_CACHE=off to disable.

const crypto = require("crypto");

const STORE_NAME = "answer-cache";
const TTL_DAYS = Number(process.env.ANSWER_CACHE_TTL_DAYS) || 30;
const enabled = () => String(process.env.ANSWER_CACHE || "on").toLowerCase() !== "off";

// Case, spacing and punctuation are ignored; numbers, units and every script's letters are
// kept exactly, so "M25" never matches "M30" and "100 sq ft" never matches "1000 sq ft".
function normalizeQuestion(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s.:/×]/gu, " ")
    .replace(/(?<!\d)[.:/]|[.:/](?!\d)/g, " ")   // keep 12.5, 1:2:4, 80/95; drop other . : /
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey({ model, effort, system, message, context, settings }) {
  const material = JSON.stringify({ model, effort, system, question: normalizeQuestion(message), context, settings });
  return crypto.createHash("sha256").update(material).digest("hex");
}

const isCacheKey = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

function openStore(event) {
  try {
    const { getStore, connectLambda } = require("@netlify/blobs");
    if (event?.blobs) connectLambda(event);
    return getStore(STORE_NAME);
  } catch {
    return null;
  }
}

async function getCachedAnswer(store, key, now = Date.now()) {
  if (!store || !enabled()) return null;
  try {
    const entry = await store.get(key, { type: "json" });
    if (!entry?.reply || !entry.at) return null;
    if (now - Date.parse(entry.at) > TTL_DAYS * 86400e3) return null;
    return entry;
  } catch (error) {
    console.error("Answer cache read failed:", error?.name || error);
    return null;
  }
}

async function saveAnswer(store, key, { reply, model, question }) {
  if (!store || !enabled() || !reply) return;
  try {
    await store.setJSON(key, { reply, model, question: String(question).slice(0, 300), at: new Date().toISOString() });
  } catch (error) {
    console.error("Answer cache write failed:", error?.name || error);
  }
}

async function deleteAnswer(store, key) {
  if (!store || !isCacheKey(key)) return false;
  try { await store.delete(key); return true; } catch { return false; }
}

module.exports = { normalizeQuestion, cacheKey, isCacheKey, openStore, getCachedAnswer, saveAnswer, deleteAnswer, TTL_DAYS };
