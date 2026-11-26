"use strict";
// "📦 Get delivery quotes": a material delivery request (India, non-cement materials), sent from
// materials.html with the person's consent. Stored in the Netlify Blobs store "leads" for the owner
// dashboard (owner-leads.js), which forwards it to partner suppliers. Kept 180 days.
const crypto = require("crypto");
const { isAllowedOrigin, clientIp, ipKey } = require("./rate-limit");
const Leads = require("../../assets/leads.js");
const usage = require("./usage-stats");

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
  await store.setJSON(key, { id, key, at: now.toISOString(), status: "new", ...lead });
  await usage.record(event, { kind: "lead", city: lead.city, categories: [...new Set(lead.items.map((x) => x.category))], source: lead.source || undefined });
  return reply(200, { ok: true, id });
};
module.exports = Object.assign(module.exports, { setStoreForTests, PER_IP_DAY });
