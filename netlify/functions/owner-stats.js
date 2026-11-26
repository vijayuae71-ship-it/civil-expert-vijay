"use strict";
// Owner dashboard data (owner.html). Private: the request must carry the OWNER_KEY set in Netlify.
// GET ?days=7|30|90 → per-day summaries, totals, recent questions (today) and recent 👎 with reasons.
const crypto = require("crypto");
const usage = require("./usage-stats");
const { keyOk } = require("./owner-auth");

let feedbackOverride;
function setFeedbackStoreForTests(store) { feedbackOverride = store; }
function openFeedback(event) {
  if (feedbackOverride !== undefined) return feedbackOverride;
  try {
    const { getStore, connectLambda } = require("@netlify/blobs");
    if (event?.blobs) connectLambda(event);
    return getStore("answer-feedback");
  } catch { return null; }
}

async function listKeys(store, prefix) {
  const { blobs = [] } = await store.list({ prefix });
  return blobs.map((b) => b.key);
}
async function getAll(store, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 25) out.push(...(await Promise.all(keys.slice(i, i + 25).map((k) => store.get(k, { type: "json" }).catch(() => null)))));
  return out.filter(Boolean);
}
function feedbackSummary(records) {
  const fb = { up: 0, down: 0, downs: [] };
  for (const r of records) {
    if (r.vote === "up") fb.up++;
    else if (r.vote === "down") { fb.down++; fb.downs.push({ at: r.at, question: String(r.question || "").slice(0, 160), reason: String(r.reason || "").slice(0, 200), language: r.language }); }
  }
  fb.downs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  fb.downs = fb.downs.slice(0, 10);
  return fb;
}

async function daySummary(store, fbStore, day, today) {
  if (day < today) {
    const saved = await store.get(`sum/${day}`, { type: "json" }).catch(() => null);
    if (saved) return saved;
  }
  const keys = await listKeys(store, `ev/${day}/`);
  const events = await getAll(store, keys);
  const fb = fbStore ? feedbackSummary(await getAll(fbStore, (await listKeys(fbStore, `${day}/`)).slice(0, 500))) : { up: 0, down: 0, downs: [] };
  const summary = { day, ...usage.summarize(events), feedback: fb };
  if (day === today) summary.recent = events.filter((e) => e.q).sort((a, b) => b.at - a.at).slice(0, 25).map((e) => ({ at: e.at, q: e.q, channel: e.channel, audience: e.audience, language: e.language, cached: e.cached }));
  else {   // the day is over: keep the summary, drop the raw records
    await store.setJSON(`sum/${day}`, summary);
    await Promise.all(keys.map((k) => store.delete(k).catch(() => {})));
  }
  return summary;
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const fail = (statusCode, error) => ({ statusCode, headers, body: JSON.stringify({ error }) });
  if (event.httpMethod !== "GET") return fail(405, "Method Not Allowed");
  const ok = keyOk(event);
  if (ok === null) return fail(503, "Set OWNER_KEY (at least 12 characters) in Netlify → Site configuration → Environment variables, then redeploy.");
  if (!ok) return fail(401, "Wrong owner key.");
  const days = Math.min(90, Math.max(1, parseInt(event.queryStringParameters?.days, 10) || 7));
  const store = usage.openStore(event);
  if (!store) return fail(503, "Storage is not available. Try again in a minute.");
  const fbStore = openFeedback(event);
  const today = usage.dayOf();
  const list = [];
  for (let i = days - 1; i >= 0; i--) list.push(usage.dayOf(Date.now() - i * 864e5));
  try {
    const summaries = [];
    for (const day of list) summaries.push(await daySummary(store, fbStore, day, today));
    return { statusCode: 200, headers, body: JSON.stringify({ today, days: summaries, prices: usage.PRICES }) };
  } catch (e) {
    console.error("Owner stats failed:", e?.name || e);
    return fail(500, "Could not read the usage data. Try again.");
  }
};

module.exports = Object.assign(module.exports, { setFeedbackStoreForTests });
