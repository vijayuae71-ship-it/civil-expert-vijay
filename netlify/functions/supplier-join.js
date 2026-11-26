"use strict";
// "Join as a supplier" (suppliers.html): a dealer registers; the owner approves them on the dashboard
// before any request is sent to them. Stored as prov/<id> in the "leads" store with approved: false.
const { isAllowedOrigin, clientIp, ipKey } = require("./rate-limit");
const lead = require("./lead");
const M = require("./market");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });
  if (!isAllowedOrigin(event)) return reply(403, { error: "Requests are accepted only from this website." });
  let input;
  try { input = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Send JSON." }); }
  if (input.agree !== true) return reply(400, { error: "Please accept the supplier terms." });
  let p; try { p = M.cleanProvider(input); } catch (e) { return reply(400, { error: e.message }); }
  const store = lead.openStore(event);
  if (!store) return reply(503, { error: "Could not save right now. Please try again in a minute." });
  const rl = `rl/join/${new Date().toISOString().slice(0, 10)}/${ipKey(clientIp(event))}`;
  const n = (Number(await store.get(rl).catch(() => 0)) || 0) + 1;
  if (n > 3) return reply(429, { error: "Too many registrations today. Please try again tomorrow." });
  await store.set(rl, String(n));
  const existing = await lead.loadProviders(store);
  if (existing.some((x) => x.phone === p.phone)) return reply(409, { error: "This number is already registered. We'll be in touch." });
  const id = M.newId();
  await store.setJSON(`prov/${id}`, { id, ...p, approved: false, active: true, joinedAt: new Date().toISOString(), openOffers: 0 });
  return reply(200, { ok: true });
};
