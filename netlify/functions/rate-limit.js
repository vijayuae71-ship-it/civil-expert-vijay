"use strict";

// Per-visitor and site-wide request limits that protect the AI (Claude API) bill.
// Counts live in Netlify Blobs so they hold across function instances; if Blobs is
// unavailable (local dev, outage) an in-memory counter for this instance is used, so
// the chat keeps working rather than failing closed.

const LIMITS = Object.freeze({
  perIpPerHour: Number(process.env.CHAT_LIMIT_PER_IP_HOUR) || 30,
  perIpPerDay: Number(process.env.CHAT_LIMIT_PER_IP_DAY) || 120,
  sitePerDay: Number(process.env.CHAT_LIMIT_SITE_DAY) || 2000
});

const crypto = require("crypto");
const memory = new Map();

// IP addresses are never stored: counters are keyed by a one-way keyed hash of the address.
const ipKey = (ip) => crypto.createHmac("sha256", process.env.PRIVACY_SALT || process.env.ANTHROPIC_API_KEY || "construction-ai-expert").update(String(ip)).digest("hex").slice(0, 24);

function clientIp(event) {
  const h = event?.headers || {};
  return String(h["x-nf-client-connection-ip"] || h["x-forwarded-for"] || h["client-ip"] || "unknown").split(",")[0].trim();
}

// Blocks scripted calls from other websites. Browsers always send Origin on a
// cross-site POST; requests with no Origin (curl) are still subject to the counters.
function isAllowedOrigin(event) {
  const h = event?.headers || {};
  const origin = h.origin || h.Origin;
  if (!origin) return true;
  let host;
  try { host = new URL(origin).host; } catch { return false; }
  const siteHost = h.host || h.Host;
  const extra = String(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return host === siteHost || /^localhost(:\d+)?$/.test(host) || /--(constructionaiexpert|civilengineervijay)\.netlify\.app$/.test(host) || extra.includes(host);
}

async function openStore(event) {
  try {
    const { getStore, connectLambda } = require("@netlify/blobs");
    if (event?.blobs) connectLambda(event);
    return getStore("chat-rate-limit");
  } catch {
    return null;
  }
}

async function bump(store, key, ttlMs) {
  if (store) {
    try {
      const current = Number(await store.get(key)) || 0;
      await store.set(key, String(current + 1));
      return current + 1;
    } catch {
      // fall through to memory
    }
  }
  const now = Date.now();
  const entry = memory.get(key);
  const count = entry && entry.expires > now ? entry.count + 1 : 1;
  memory.set(key, { count, expires: now + ttlMs });
  if (memory.size > 5000) for (const [k, v] of memory) if (v.expires <= now) memory.delete(k);
  return count;
}

// The owner can change the limits and set a daily AI budget from the owner dashboard (owner-settings.js);
// they are saved in this store under settings/limits. Netlify environment variables are the defaults.
// A budget of 0 means no budget. Read at most once a minute per function instance.
const RANGES = { sitePerDay: [10, 100000], perIpPerHour: [1, 1000], perIpPerDay: [1, 5000], dailyBudgetUsd: [0, 10000] };
const DEFAULTS = { ...LIMITS, dailyBudgetUsd: Number(process.env.CHAT_DAILY_BUDGET_USD) || 0 };
let cached = { at: 0, value: null };
function cleanLimits(input = {}) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    if (input[k] === undefined || input[k] === null || input[k] === "") continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${k} must be between ${lo} and ${hi}.`);
    out[k] = k === "dailyBudgetUsd" ? Math.round(n * 100) / 100 : Math.round(n);
  }
  return out;
}
async function savedLimits(s) {
  if (!s) return {};
  try { const v = await s.get("settings/limits", { type: "json" }); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
async function currentLimits(s, { fresh = false } = {}) {
  if (!fresh && cached.value && Date.now() - cached.at < 60e3) return cached.value;
  let saved = {};
  try { saved = cleanLimits(await savedLimits(s)); } catch { saved = {}; }
  cached = { at: Date.now(), value: { ...DEFAULTS, ...saved } };
  return cached.value;
}
async function saveLimits(s, input) {
  const clean = cleanLimits(input);
  if (!s) throw new Error("Storage is not available. Try again in a minute.");
  await s.setJSON("settings/limits", { ...clean, updatedAt: new Date().toISOString() });
  cached = { at: 0, value: null };
  return currentLimits(s, { fresh: true });
}

// Today's estimated AI spend (US$), added after each answer (chat.js) and checked against the budget.
const costKey = (day) => `cost/${day}`;
async function addCost(event, usd, { store, now = new Date() } = {}) {
  if (!(usd > 0)) return;
  const s = store === undefined ? await openStore(event) : store;
  if (!s) return;
  try { const key = costKey(now.toISOString().slice(0, 10)); await s.set(key, String((Number(await s.get(key)) || 0) + usd)); } catch {}
}
async function today(s, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (!s) return { day, questions: 0, costUsd: 0 };
  const [q, c] = await Promise.all([s.get(`site/${day}`).catch(() => 0), s.get(costKey(day)).catch(() => 0)]);
  return { day, questions: Number(q) || 0, costUsd: Math.round((Number(c) || 0) * 10000) / 10000 };
}

// Returns null when allowed, or { statusCode, error } when the request must be refused.
async function checkRateLimit(event, { store, now = new Date() } = {}) {
  const ip = ipKey(clientIp(event));
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const s = store === undefined ? await openStore(event) : store;
  const limits = await currentLimits(s);
  if (limits.dailyBudgetUsd > 0 && s) {
    const spent = Number(await s.get(costKey(day)).catch(() => 0)) || 0;
    if (spent >= limits.dailyBudgetUsd) return { statusCode: 503, error: "The expert has reached today's question limit. Please try again tomorrow." };
  }
  const [ipHour, ipDay, site] = await Promise.all([
    bump(s, `ip/${ip}/${hour}`, 3600e3),
    bump(s, `ip/${ip}/${day}`, 86400e3),
    bump(s, `site/${day}`, 86400e3)
  ]);
  if (site > limits.sitePerDay) return { statusCode: 503, error: "The expert has reached today's question limit. Please try again tomorrow." };
  if (ipHour > limits.perIpPerHour || ipDay > limits.perIpPerDay) return { statusCode: 429, error: "You've asked a lot of questions in a short time. Please wait a while and try again." };
  return null;
}

module.exports = { LIMITS, DEFAULTS, RANGES, checkRateLimit, isAllowedOrigin, clientIp, ipKey, openStore, currentLimits, saveLimits, cleanLimits, addCost, today, _memory: memory, _resetCache: () => { cached = { at: 0, value: null }; } };
