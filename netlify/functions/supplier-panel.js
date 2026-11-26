"use strict";
// Dealer panel (dealer.html?k=<token>): a supplier's personal link, given by the owner on approval.
// GET  → the supplier's profile, stats and their requests (newest first) with a link to each.
// POST {k, action: "pause" | "resume"} → stop or start getting new requests.
const { isAllowedOrigin } = require("./rate-limit");
const lead = require("./lead");
const M = require("./market");
const Leads = require("../../assets/leads.js");

const TOKEN = /^[a-f0-9]{32}$/;
exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });
  if (event.httpMethod === "POST" && !isAllowedOrigin(event)) return reply(403, { error: "Requests are accepted only from this website." });
  const store = lead.openStore(event);
  if (!store) return reply(503, { error: "Not available right now. Please try again in a minute." });
  let body = {};
  if (event.httpMethod === "POST") { try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Send JSON." }); } }
  const k = event.httpMethod === "GET" ? event.queryStringParameters?.k : body.k;
  if (!TOKEN.test(String(k || ""))) return reply(404, { error: "This link is not valid. Ask us for your dealer panel link on WhatsApp." });
  const tok = await store.get(`tok/${k}`, { type: "json" }).catch(() => null);
  const p = tok && tok.role === "panel" ? await store.get(`prov/${tok.providerId}`, { type: "json" }).catch(() => null) : null;
  if (!p) return reply(404, { error: "This link is not valid. Ask us for your dealer panel link on WhatsApp." });
  try {
    if (event.httpMethod === "POST") {
      if (!["pause", "resume"].includes(body.action)) return reply(400, { error: "Unknown action." });
      p.active = body.action === "resume";
      await store.setJSON(`prov/${p.id}`, p);
    }
    const rows = [];
    for (const r of (p.requests || []).slice(0, 100)) {
      const rec = await store.get(r.leadKey, { type: "json" }).catch(() => null);
      const offer = rec && (rec.offers || []).find((o) => o.token === r.token);
      if (!offer) continue;   // deleted after 180 days
      const total = M.quoteTotal(rec, offer.quote);
      rows.push({ token: r.token, at: r.at, where: `${rec.area ? `${rec.area}, ` : ""}${rec.city} ${rec.pin}`, neededBy: rec.neededBy, items: rec.items.map((x) => `${x.name} ${x.qty} ${x.unit}`).join(" · "),
        status: offer.status, fulfil: offer.fulfil ? offer.fulfil.status : null, total: total ? total.total : null, cancelled: !!rec.cancelled });
    }
    const count = (f) => rows.filter(f).length;
    return reply(200, {
      profile: { business: p.business, name: p.name, phone: p.phone, city: p.city, pins: p.pins, categories: p.categories.map((c) => Leads.LABEL[c] || c), active: p.active !== false, approved: !!p.approved },
      stats: { toQuote: count((x) => x.status === "sent" && !x.cancelled), quoted: count((x) => x.status === "quoted"), won: count((x) => x.status === "chosen"), delivered: p.delivered || 0, rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : null, ratings: p.ratingCount || 0 },
      requests: rows
    });
  } catch (e) {
    console.error("Dealer panel failed:", e?.name || e);
    return reply(500, { error: "Something went wrong. Please try again." });
  }
};
