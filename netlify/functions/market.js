"use strict";
// Material delivery marketplace (India, non-cement): suppliers, matching, quotes and fulfilment.
// Store: Netlify Blobs "leads" (shared with lead.js / owner-leads.js):
//   lead/<day>/<ts>-<id>  a request, with offers[] (one per supplier it was sent to)
//   prov/<id>             a supplier: business, contact, WhatsApp number, city, PINs served, materials
//   tok/<token>           a private link: { leadKey, role: "customer" | "provider", providerId? }
//   settings/market       { commissionPct }
// Privacy: a supplier sees the materials and the site area/PIN; the customer's name and mobile are
// shown only to the supplier the customer chooses, and the chosen supplier's contact to the customer.
const crypto = require("crypto");
const Leads = require("../../assets/leads.js");

const MAX_SUPPLIERS = 3;
const OFFER_STATUSES = ["sent", "quoted", "declined", "chosen", "not-chosen"];
const FULFIL = ["confirmed", "dispatched", "delivered"];
const token = () => crypto.randomBytes(16).toString("hex");
const newId = () => crypto.randomBytes(6).toString("hex");
const pinOk = (p) => /^[1-9]\d{5}$/.test(String(p || ""));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const s = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const CATEGORY_KEYS = Leads.CATEGORIES.map(([k]) => k);

// ---------- suppliers ----------
function cleanProvider(input = {}, { owner = false } = {}) {
  const phone = String(input.phone || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
  if (!/^[6-9]\d{9}$/.test(phone)) throw new Error("Enter a 10-digit Indian mobile (WhatsApp) number.");
  const business = s(input.business, 80);
  if (!business) throw new Error("Enter the business name.");
  const city = s(input.city, 40);
  if (!city) throw new Error("Choose the city.");
  const pins = [...new Set(String(Array.isArray(input.pins) ? input.pins.join(",") : input.pins || "").split(/[^\d]+/).filter((p) => /^\d{3,6}$/.test(p)))].slice(0, 60);
  const categories = (Array.isArray(input.categories) ? input.categories : []).filter((c) => CATEGORY_KEYS.includes(c));
  if (!categories.length) throw new Error("Choose at least one material you supply.");
  const out = { business, name: s(input.name, 60), phone: `+91${phone}`, city, pins, categories, gstin: s(input.gstin, 15).toUpperCase() };
  if (owner) { out.approved = input.approved !== false; out.active = input.active !== false; }
  return out;
}
// A supplier serves a PIN when it lists it, or a 3–5 digit prefix of it; no PINs listed = the whole city.
const servesPin = (p, pin) => !p.pins || !p.pins.length || p.pins.some((x) => String(pin).startsWith(x));
const sameCity = (a, b) => s(a, 40).toLowerCase() === s(b, 40).toLowerCase();

// Up to 3 approved, active suppliers in the city who serve the PIN and stock at least one of the
// materials; fewest open offers first (fair share), then best rated.
function match(lead, providers, { exclude = [] } = {}) {
  const cats = new Set(lead.items.map((x) => x.category));
  return providers
    .filter((p) => p.approved && p.active !== false && !exclude.includes(p.id) && sameCity(p.city, lead.city) && servesPin(p, lead.pin) && p.categories.some((c) => cats.has(c)))
    .map((p) => ({ p, load: p.openOffers || 0, rating: p.ratingCount ? p.ratingSum / p.ratingCount : 3.5 }))
    .sort((a, b) => a.load - b.load || b.rating - a.rating || a.p.id.localeCompare(b.p.id))
    .slice(0, MAX_SUPPLIERS).map((x) => x.p);
}

// ---------- quotes ----------
// rates: one per item (null = not available); delivery charge; date; validity; GST included?
function cleanQuote(lead, input = {}) {
  const rates = (Array.isArray(input.rates) ? input.rates : []).slice(0, lead.items.length);
  const items = lead.items.map((_, i) => { const r = Number(rates[i]); return Number.isFinite(r) && r > 0 && r < 1e7 ? round2(r) : null; });
  if (!items.some((r) => r !== null)) throw new Error("Enter a rate for at least one material.");
  const delivery = Math.max(0, round2(input.delivery));
  const date = s(input.deliveryDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose the delivery date.");
  return { rates: items, delivery, deliveryDate: date, validDays: Math.min(30, Math.max(1, Math.round(Number(input.validDays) || 3))), gstIncluded: input.gstIncluded !== false, note: s(input.note, 300) };
}
function quoteTotal(lead, q) {
  if (!q) return null;
  const lines = lead.items.map((it, i) => (q.rates[i] === null ? null : round2(it.qty * q.rates[i])));
  const materials = round2(lines.reduce((a, b) => a + (b || 0), 0));
  return { lines, materials, delivery: q.delivery, total: round2(materials + q.delivery), missing: lines.filter((x) => x === null).length };
}

// The request's status follows its offers: new → sent → quoted → ordered → delivered (or lost).
function leadStatus(lead) {
  if (lead.cancelled) return "lost";
  const offers = lead.offers || [];
  const chosen = offers.find((o) => o.status === "chosen");
  if (chosen) return chosen.fulfil && chosen.fulfil.status === "delivered" ? "delivered" : "ordered";
  if (offers.some((o) => o.status === "quoted")) return "quoted";
  if (offers.length) return offers.every((o) => o.status === "declined") ? "lost" : "sent";
  return "new";
}

// ---------- what each side sees ----------
function providerView(lead, offer) {
  const chosen = offer.status === "chosen";
  return {
    role: "provider", status: offer.status, items: lead.items, city: lead.city, area: lead.area, pin: lead.pin, neededBy: lead.neededBy, role_: lead.role, notes: lead.notes,
    quote: offer.quote || null, total: quoteTotal(lead, offer.quote), fulfil: offer.fulfil || null,
    customer: chosen ? { name: lead.name, phone: lead.phone } : null, rating: chosen ? lead.rating || null : null, at: lead.at
  };
}
function customerView(lead, providers) {
  const offers = (lead.offers || []).map((o, i) => {
    const p = providers[o.providerId] || {};
    const chosen = o.status === "chosen";
    return { n: i + 1, status: o.status, business: p.business || "Supplier", rating: p.ratingCount ? round2(p.ratingSum / p.ratingCount) : null, ratings: p.ratingCount || 0,
      quote: o.quote || null, total: quoteTotal(lead, o.quote), fulfil: o.fulfil || null, contact: chosen ? { name: p.name, phone: p.phone, business: p.business } : null };
  });
  return { role: "customer", status: leadStatus(lead), items: lead.items, city: lead.city, area: lead.area, pin: lead.pin, neededBy: lead.neededBy, offers, rating: lead.rating || null, at: lead.at };
}

// The message a supplier gets (WhatsApp) with their private quote link.
const providerMessage = (lead, link) => `${Leads.message(lead).replace("Please reply with your price including delivery.", "")}\nSend your rates here (no login needed):\n${link}`.replace(/\n{3,}/g, "\n\n");

module.exports = { MAX_SUPPLIERS, OFFER_STATUSES, FULFIL, CATEGORY_KEYS, token, newId, pinOk, cleanProvider, servesPin, match, cleanQuote, quoteTotal, leadStatus, providerView, customerView, providerMessage };
