"use strict";

// Per-visitor and site-wide request limits that protect the Gemini bill.
// Counts live in Netlify Blobs so they hold across function instances; if Blobs is
// unavailable (local dev, outage) an in-memory counter for this instance is used, so
// the chat keeps working rather than failing closed.

const LIMITS = Object.freeze({
  perIpPerHour: Number(process.env.CHAT_LIMIT_PER_IP_HOUR) || 30,
  perIpPerDay: Number(process.env.CHAT_LIMIT_PER_IP_DAY) || 120,
  sitePerDay: Number(process.env.CHAT_LIMIT_SITE_DAY) || 2000
});

const memory = new Map();

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
  return host === siteHost || /^localhost(:\d+)?$/.test(host) || /--civil-expert-vijay\.netlify\.app$/.test(host) || extra.includes(host);
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

// Returns null when allowed, or { statusCode, error } when the request must be refused.
async function checkRateLimit(event, { store, now = new Date() } = {}) {
  const ip = clientIp(event);
  const hour = now.toISOString().slice(0, 13);
  const day = now.toISOString().slice(0, 10);
  const s = store === undefined ? await openStore(event) : store;
  const [ipHour, ipDay, site] = await Promise.all([
    bump(s, `ip/${ip}/${hour}`, 3600e3),
    bump(s, `ip/${ip}/${day}`, 86400e3),
    bump(s, `site/${day}`, 86400e3)
  ]);
  if (site > LIMITS.sitePerDay) return { statusCode: 503, error: "The expert has reached today's question limit. Please try again tomorrow." };
  if (ipHour > LIMITS.perIpPerHour || ipDay > LIMITS.perIpPerDay) return { statusCode: 429, error: "You've asked a lot of questions in a short time. Please wait a while and try again." };
  return null;
}

module.exports = { LIMITS, checkRateLimit, isAllowedOrigin, clientIp, _memory: memory };
