"use strict";
// "📦 Get delivery quotes": a material delivery request (India, non-cement materials), sent from
// materials.html with the person's consent. Stored in the Netlify Blobs store "leads" for the owner
// dashboard (owner-leads.js), which forwards it to partner suppliers. Kept 180 days.
const crypto = require("crypto");
const { isAllowedOrigin, clientIp, ipKey } = require("./rate-limit");
const Leads = require("../../assets/leads.js");
const usage = require("./usage-stats");
const M = require("./market");
const wa = require("./wa-send");

const SITE = (process.env.URL || "https://civilengineervijay.netlify.app").replace(/\/$/, "");
// All suppliers (small list: one blob each under prov/).
async function loadProviders(store) {
  const { blobs = [] } = await store.list({ prefix: "prov/" });
  return (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" }).catch(() => null)))).filter(Boolean);
}
// Send the request to up to 3 matching suppliers: an offer + a private link each; WhatsApp them when a
// template is set up. Returns the offers added.
async function sendToSuppliers(store, rec, { exclude = [] } = {}) {
  const providers = await loadProviders(store);
  const picked = M.match(rec, providers, { exclude: [...exclude, ...(rec.offers || []).map((o) => o.providerId)] });
  const added = [];
  for (const p of picked) {
    const t = M.token();
    await store.setJSON(`tok/${t}`, { leadKey: rec.key, role: "provider", providerId: p.id });
    const offer = { providerId: p.id, token: t, status: "sent", sentAt: new Date().toISOString() };
    offer.notified = await wa.sendTemplate("supplier", p.phone, [`${rec.area ? `${rec.area}, ` : ""}${rec.city} ${rec.pin}`, `${SITE}/quote?t=${t}`]);
    added.push(offer);
    // The supplier's own list of requests (their dealer panel), newest first, last 200.
    await store.setJSON(`prov/${p.id}`, { ...p, openOffers: (p.openOffers || 0) + 1, requests: [{ leadKey: rec.key, token: t, at: offer.sentAt }, ...(p.requests || [])].slice(0, 200) });
  }
  rec.offers = [...(rec.offers || []), ...added];
  return added;
}

const PER_IP_DAY = 5;
let storeOverride;
function setStoreForTests(store) { storeOverride = store; }
function openStore(event) {
  if (storeOverride !== undefined) return storeOverride;
  try { const { getStore, connectLambda } = require("@netlify/blobs"); if (event?.blobs) connectLambda(event); return getStore("leads"); } catch { return null; }
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });
  if (!isAllowedOrigin(event)) return reply(403, { error: "Requests are accepted only from this website." });
  if (String(event.body || "").length > 20000) return reply(413, { error: "This request is too long." });
  let lead;
  try { lead = Leads.clean(JSON.parse(event.body || "{}")); }
  catch (e) { return reply(400, { error: e instanceof SyntaxError ? "Send the request as JSON." : e.message }); }
  const store = openStore(event);
  if (!store) return reply(503, { error: "Could not save your request right now. Please try again in a minute." });
  const now = new Date(), day = now.toISOString().slice(0, 10);
  const rl = `rl/${day}/${ipKey(clientIp(event))}`;
  const count = (Number(await store.get(rl).catch(() => 0)) || 0) + 1;
  if (count > PER_IP_DAY) return reply(429, { error: "You've sent several requests today. We'll be in touch about them — please try again tomorrow for a new one." });
  await store.set(rl, String(count));
  const id = crypto.randomBytes(6).toString("hex");
  const key = `lead/${day}/${now.getTime()}-${id}`;
  const ctoken = M.token();
  const rec = { id, key, at: now.toISOString(), ...lead, ctoken, offers: [] };
  await store.setJSON(`tok/${ctoken}`, { leadKey: key, role: "customer" });
  await sendToSuppliers(store, rec);
  rec.status = M.leadStatus(rec);
  await store.setJSON(key, rec);
  await usage.record(event, { kind: "lead", city: lead.city, categories: [...new Set(lead.items.map((x) => x.category))], source: lead.source || undefined });
  return reply(200, { ok: true, id, track: ctoken, suppliers: rec.offers.length });
};
module.exports = Object.assign(module.exports, { setStoreForTests, PER_IP_DAY, sendToSuppliers, loadProviders, openStore, SITE });
