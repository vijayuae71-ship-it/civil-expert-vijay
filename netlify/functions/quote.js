"use strict";
// Private links for the material marketplace (quote.html?t=<token>): no login, the token is the key.
// Supplier link:  GET → the request (materials, area/PIN; the customer's contact only once chosen)
//                 POST {action:"quote", rates[], delivery, deliveryDate, validDays, gstIncluded, note}
//                 POST {action:"decline"} · POST {action:"fulfil", status: confirmed|dispatched|delivered}
// Customer link:  GET → all quotes side by side (the chosen supplier's contact once chosen)
//                 POST {action:"choose", n} · POST {action:"received", rating 1–5} · POST {action:"cancel"}
const { isAllowedOrigin } = require("./rate-limit");
const lead = require("./lead");
const M = require("./market");
const wa = require("./wa-send");

const TOKEN = /^[a-f0-9]{32}$/;
async function load(store, t) {
  if (!TOKEN.test(String(t || ""))) return null;
  const tok = await store.get(`tok/${t}`, { type: "json" }).catch(() => null);
  if (!tok) return null;
  const rec = await store.get(tok.leadKey, { type: "json" }).catch(() => null);
  return rec ? { tok, rec } : null;
}
async function providersOf(store, rec) {
  const out = {};
  for (const o of rec.offers || []) out[o.providerId] = await store.get(`prov/${o.providerId}`, { type: "json" }).catch(() => null) || {};
  return out;
}
// An offer that is no longer open frees a place in that supplier's fair share.
async function closeOffer(store, offer) {
  const p = await store.get(`prov/${offer.providerId}`, { type: "json" }).catch(() => null);
  if (p) await store.setJSON(`prov/${offer.providerId}`, { ...p, openOffers: Math.max(0, (p.openOffers || 0) - 1) });
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });
  if (event.httpMethod === "POST" && !isAllowedOrigin(event)) return reply(403, { error: "Requests are accepted only from this website." });
  const store = lead.openStore(event);
  if (!store) return reply(503, { error: "Not available right now. Please try again in a minute." });
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Send JSON." }); } }
  const t = event.httpMethod === "GET" ? event.queryStringParameters?.t : body.t;
  const found = await load(store, t);
  if (!found) return reply(404, { error: "This link is not valid or has expired." });
  const { tok, rec } = found;
  const save = async () => { rec.status = M.leadStatus(rec); rec.updatedAt = new Date().toISOString(); await store.setJSON(rec.key, rec); };
  const view = async () => (tok.role === "customer" ? M.customerView(rec, await providersOf(store, rec)) : M.providerView(rec, rec.offers.find((o) => o.providerId === tok.providerId)));

  try {
    if (event.httpMethod === "GET") return reply(200, await view());
    const a = body.action;
    if (tok.role === "provider") {
      const offer = (rec.offers || []).find((o) => o.providerId === tok.providerId);
      if (!offer) return reply(404, { error: "This request is no longer open to you." });
      const decided = rec.offers.some((o) => o.status === "chosen") || rec.cancelled;
      if (a === "quote" || a === "decline") {
        if (decided || !["sent", "quoted"].includes(offer.status)) return reply(409, { error: "The customer has already decided on this request." });
        if (a === "decline") { offer.status = "declined"; offer.declinedAt = new Date().toISOString(); await closeOffer(store, offer); await save(); return reply(200, await view()); }
        let q; try { q = M.cleanQuote(rec, body); } catch (e) { return reply(400, { error: e.message }); }
        offer.quote = { ...q, at: new Date().toISOString() }; offer.status = "quoted";
        await save();
        await wa.sendTemplate("customer", rec.phone, [String(rec.offers.filter((o) => o.quote).length), `${lead.SITE}/quote?t=${rec.ctoken}`]);
        return reply(200, await view());
      }
      if (a === "fulfil") {
        if (offer.status !== "chosen") return reply(409, { error: "Only the chosen supplier can update the delivery." });
        const next = M.FULFIL.indexOf(body.status), cur = offer.fulfil ? M.FULFIL.indexOf(offer.fulfil.status) : -1;
        if (next < 0 || next < cur) return reply(400, { error: "Update the delivery in order: confirmed, dispatched, delivered." });
        offer.fulfil = { ...(offer.fulfil || {}), status: body.status, [`${body.status}At`]: new Date().toISOString() };
        await save(); return reply(200, await view());
      }
      return reply(400, { error: "Unknown action." });
    }
    // customer
    if (a === "choose") {
      if (rec.offers.some((o) => o.status === "chosen")) return reply(409, { error: "You have already chosen a supplier." });
      const offer = rec.offers[Number(body.n) - 1];
      if (!offer || offer.status !== "quoted") return reply(400, { error: "Choose a supplier that has sent a quote." });
      for (const o of rec.offers) {
        if (o === offer) { o.status = "chosen"; o.chosenAt = new Date().toISOString(); }
        else if (["sent", "quoted"].includes(o.status)) { o.status = "not-chosen"; await closeOffer(store, o); }
      }
      rec.orderValue = M.quoteTotal(rec, offer.quote).total;
      await save();
      const p = await store.get(`prov/${offer.providerId}`, { type: "json" }).catch(() => null);
      if (p) await wa.sendTemplate("chosen", p.phone, [`${rec.area ? `${rec.area}, ` : ""}${rec.city} ${rec.pin}`, `${lead.SITE}/quote?t=${offer.token}`]);
      return reply(200, await view());
    }
    if (a === "received") {
      const offer = rec.offers.find((o) => o.status === "chosen");
      if (!offer) return reply(409, { error: "Choose a supplier first." });
      const r = Math.round(Number(body.rating));
      if (!(r >= 1 && r <= 5)) return reply(400, { error: "Rate the supplier from 1 to 5." });
      if (rec.rating) return reply(409, { error: "You have already rated this delivery." });
      offer.fulfil = { ...(offer.fulfil || {}), status: "delivered", receivedAt: new Date().toISOString() };
      rec.rating = r;
      await closeOffer(store, offer);
      const p = await store.get(`prov/${offer.providerId}`, { type: "json" }).catch(() => null);
      if (p) await store.setJSON(`prov/${offer.providerId}`, { ...p, ratingSum: (p.ratingSum || 0) + r, ratingCount: (p.ratingCount || 0) + 1, delivered: (p.delivered || 0) + 1 });
      await save(); return reply(200, await view());
    }
    if (a === "cancel") {
      if (rec.offers.some((o) => o.status === "chosen")) return reply(409, { error: "A supplier is already chosen — contact them to cancel." });
      rec.cancelled = true;
      for (const o of rec.offers) if (["sent", "quoted"].includes(o.status)) { o.status = "not-chosen"; await closeOffer(store, o); }
      await save(); return reply(200, await view());
    }
    return reply(400, { error: "Unknown action." });
  } catch (e) {
    console.error("Quote link failed:", e?.name || e);
    return reply(500, { error: "Something went wrong. Please try again." });
  }
};
