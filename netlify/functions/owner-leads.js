"use strict";
// Owner dashboard → 📥 Leads. Private: the request must carry the OWNER_KEY.
// GET  → the material delivery requests of the last 180 days, newest first (older ones are deleted).
// POST {key, status, note} → update a request's status (new / sent / quoted / ordered / lost) and note.
const { keyOk } = require("./owner-auth");
const lead = require("./lead");
const M = require("./market");

const STATUSES = ["new", "sent", "quoted", "ordered", "delivered", "lost"];
const KEEP_DAYS = 180;
let storeOverride;
function setStoreForTests(store) { storeOverride = store; }
function openStore(event) {
  if (storeOverride !== undefined) return storeOverride;
  try { const { getStore, connectLambda } = require("@netlify/blobs"); if (event?.blobs) connectLambda(event); return getStore("leads"); } catch { return null; }
}

// Each offer with the supplier's name, phone and quote total, for the dashboard.
function decorate(l, providers) {
  return { ...l, offers: (l.offers || []).map((o) => ({ ...o, business: (providers[o.providerId] || {}).business || "(removed supplier)", phone: (providers[o.providerId] || {}).phone || "", total: M.quoteTotal(l, o.quote) })) };
}
async function withNames(store, l) { return decorate(l, Object.fromEntries((await lead.loadProviders(store)).map((p) => [p.id, p]))); }

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });
  const ok = keyOk(event);
  if (ok === null) return reply(503, { error: "Set OWNER_KEY (at least 12 characters) in Netlify, then redeploy." });
  if (!ok) return reply(401, { error: "Wrong owner key." });
  const store = openStore(event);
  if (!store) return reply(503, { error: "Storage is not available. Try again in a minute." });
  try {
    if (event.httpMethod === "POST") {
      let b; try { b = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Send JSON." }); }
      if (b.action === "settings") {
        const pct = Number(b.commissionPct);
        if (!(pct >= 0 && pct <= 50)) return reply(400, { error: "Commission must be between 0 and 50%." });
        await store.setJSON("settings/market", { commissionPct: Math.round(pct * 100) / 100 });
        return reply(200, { settings: { commissionPct: Math.round(pct * 100) / 100 } });
      }
      if (!/^lead\/\d{4}-\d{2}-\d{2}\/\d+-[a-f0-9]{12}$/.test(String(b.key || ""))) return reply(400, { error: "Unknown request." });
      const cur = await store.get(b.key, { type: "json" });
      if (!cur) return reply(404, { error: "This request no longer exists." });
      if (b.status !== undefined && !STATUSES.includes(b.status)) return reply(400, { error: `Status must be one of: ${STATUSES.join(", ")}.` });
      const next = { ...cur, status: b.status ?? cur.status, note: b.note !== undefined ? String(b.note).slice(0, 300) : cur.note, updatedAt: new Date().toISOString() };
      // "Send to more suppliers": match again, skipping those already asked.
      if (b.action === "match") { await lead.sendToSuppliers(store, next); next.status = M.leadStatus(next); }
      await store.setJSON(b.key, next);
      return reply(200, { lead: await withNames(store, next) });
    }
    const { blobs = [] } = await store.list({ prefix: "lead/" });
    const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    const old = blobs.filter((x) => x.key.slice(5, 15) < cutoff).map((x) => x.key);
    await Promise.all(old.map((k) => store.delete(k).catch(() => {})));
    const keys = blobs.map((x) => x.key).filter((k) => !old.includes(k)).sort().reverse().slice(0, 300);
    const leads = [];
    for (let i = 0; i < keys.length; i += 25) leads.push(...(await Promise.all(keys.slice(i, i + 25).map((k) => store.get(k, { type: "json" }).catch(() => null)))).filter(Boolean));
    const providers = Object.fromEntries((await lead.loadProviders(store)).map((p) => [p.id, p]));
    const settings = await store.get("settings/market", { type: "json" }).catch(() => null) || { commissionPct: 0 };
    return reply(200, { leads: leads.map((l) => decorate(l, providers)), statuses: STATUSES, keepDays: KEEP_DAYS, settings, site: lead.SITE });
  } catch (e) {
    console.error("Owner leads failed:", e?.name || e);
    return reply(500, { error: "Could not read the requests. Try again." });
  }
};
module.exports = Object.assign(module.exports, { setStoreForTests, STATUSES, KEEP_DAYS });
