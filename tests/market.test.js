"use strict";
// Material marketplace: request → nearby suppliers → quotes → customer chooses → delivery → rating.
const test = require("node:test");
const assert = require("node:assert/strict");
const lead = require("../netlify/functions/lead");
const quote = require("../netlify/functions/quote");
const join = require("../netlify/functions/supplier-join");
const ownerProviders = require("../netlify/functions/owner-providers");
const ownerLeads = require("../netlify/functions/owner-leads");
const usage = require("../netlify/functions/usage-stats");
const wa = require("../netlify/functions/wa-send");
const M = require("../netlify/functions/market");

const memory = () => {
  const data = new Map();
  return { data, get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null), set: async (k, v) => { data.set(k, String(v)); }, setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); }, delete: async (k) => { data.delete(k); }, list: async ({ prefix = "" } = {}) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }) };
};
const H = { host: "site", origin: "https://site", "x-nf-client-connection-ip": "7.7.7.7" };
const post = (fn, body, headers = H) => fn.handler({ httpMethod: "POST", headers, body: JSON.stringify(body) });
const get = (t) => quote.handler({ httpMethod: "GET", headers: H, queryStringParameters: { t } });
const json = (r) => JSON.parse(r.body);
const prov = (id, extra) => ({ id, business: `Dealer ${id}`, name: "Owner", phone: `+9198450000${id.slice(-2)}`, city: "Mysuru", pins: [], categories: ["steel", "sand"], approved: true, active: true, openOffers: 0, ...extra });

function setup() {
  const store = memory(); lead.setStoreForTests(store); ownerLeads.setStoreForTests(store); usage.setStoreForTests(null);
  for (const p of [prov("aaaaaaaaaa01", { ratingSum: 9, ratingCount: 2 }), prov("aaaaaaaaaa02", { pins: ["5700"] }), prov("aaaaaaaaaa03", { pins: ["5710"] }), prov("aaaaaaaaaa04", { city: "Bengaluru" }), prov("aaaaaaaaaa05", { approved: false }), prov("aaaaaaaaaa06", { categories: ["tiles"] }), prov("aaaaaaaaaa07", { pins: ["570017"], categories: ["sand"] })])
    store.data.set(`prov/${p.id}`, JSON.stringify(p));
  return store;
}
const REQ = { items: [{ name: "TMT steel 12 mm", qty: 300, unit: "kg" }, { name: "M-sand", qty: 2, unit: "m³" }], city: "Mysuru", area: "Vijayanagar", pin: "570017", neededBy: "2026-12-01", name: "Ravi", phone: "9845012345", consent: true };

test("matching: approved suppliers in the city, serving the PIN and the materials; best rated first", () => {
  const lst = [prov("x1"), prov("x2", { pins: ["5700"], ratingSum: 10, ratingCount: 2 }), prov("x3", { pins: ["5710"] }), prov("x4", { city: "Bengaluru" }), prov("x5", { approved: false }), prov("x6", { categories: ["tiles"] }), prov("x7", { active: false }), prov("x8", { openOffers: 4 })];
  const m = M.match({ city: "mysuru", pin: "570017", items: [{ category: "steel" }] }, lst).map((p) => p.id);
  assert.deepEqual(m, ["x2", "x1", "x8"]);
  assert.equal(M.match({ city: "Mysuru", pin: "570017", items: [{ category: "steel" }] }, lst, { exclude: ["x2"] }).length, 2);
});

test("full flow: request → 3 suppliers → quotes → customer chooses → delivery → rating", async () => {
  const store = setup();
  const r = json(await post(lead, REQ));
  assert.equal(r.suppliers, 3); assert.match(r.track, /^[a-f0-9]{32}$/);
  const rec = JSON.parse([...store.data.entries()].find(([k]) => k.startsWith("lead/"))[1]);
  assert.deepEqual(rec.offers.map((o) => o.providerId), ["aaaaaaaaaa01", "aaaaaaaaaa02", "aaaaaaaaaa07"], "best rated first; wrong PIN area, other city, unapproved and tiles-only skipped");
  assert.equal(rec.status, "sent");
  const [o1, o2, o3] = rec.offers;
  // a supplier sees the request but not the customer's contact
  const pv = json(await get(o1.token));
  assert.equal(pv.role, "provider"); assert.equal(pv.customer, null); assert.equal(pv.pin, "570017");
  assert.ok(!JSON.stringify(pv).includes("9845012345"));
  // quotes
  assert.equal((await post(quote, { t: o1.token, action: "quote", rates: [68, 1500], delivery: 500, deliveryDate: "2026-12-01" })).statusCode, 200);
  assert.equal((await post(quote, { t: o2.token, action: "quote", rates: [65, null], delivery: 300, deliveryDate: "2026-12-02", gstIncluded: false })).statusCode, 200);
  assert.equal((await post(quote, { t: o3.token, action: "decline" })).statusCode, 200);
  assert.equal((await post(quote, { t: o1.token, action: "quote", rates: [], deliveryDate: "2026-12-01" })).statusCode, 400);
  // the customer compares (no supplier phone before choosing)
  const cv = json(await get(r.track));
  assert.equal(cv.status, "quoted");
  assert.deepEqual(cv.offers.map((o) => [o.status, o.total && o.total.total]), [["quoted", 23900], ["quoted", 19800], ["declined", null]]);
  assert.ok(cv.offers.every((o) => o.contact === null));
  assert.equal((await post(quote, { t: r.track, action: "choose", n: 3 })).statusCode, 400, "a declined supplier can't be chosen");
  const chosen = json(await post(quote, { t: r.track, action: "choose", n: 1 }));
  assert.equal(chosen.status, "ordered");
  assert.equal(chosen.offers[0].contact.phone, "+919845000001");
  assert.equal(chosen.offers[1].status, "not-chosen");
  assert.equal((await post(quote, { t: r.track, action: "choose", n: 2 })).statusCode, 409);
  assert.equal((await post(quote, { t: o2.token, action: "quote", rates: [60, null], delivery: 0, deliveryDate: "2026-12-02" })).statusCode, 409, "too late to quote");
  // the chosen supplier now sees the customer, and updates the delivery in order
  assert.equal(json(await get(o1.token)).customer.phone, "+919845012345");
  assert.equal(json(await get(o2.token)).customer, null);
  assert.equal((await post(quote, { t: o2.token, action: "fulfil", status: "confirmed" })).statusCode, 409);
  assert.equal(json(await post(quote, { t: o1.token, action: "fulfil", status: "confirmed" })).fulfil.status, "confirmed");
  assert.equal(json(await post(quote, { t: o1.token, action: "fulfil", status: "dispatched" })).fulfil.status, "dispatched");
  assert.equal((await post(quote, { t: o1.token, action: "fulfil", status: "confirmed" })).statusCode, 400, "no going back");
  // the customer confirms receipt and rates
  assert.equal((await post(quote, { t: r.track, action: "received", rating: 9 })).statusCode, 400);
  const done = json(await post(quote, { t: r.track, action: "received", rating: 5 }));
  assert.equal(done.status, "delivered"); assert.equal(done.rating, 5);
  const p1 = JSON.parse(store.data.get("prov/aaaaaaaaaa01"));
  assert.deepEqual([p1.ratingSum, p1.ratingCount, p1.delivered, p1.openOffers], [14, 3, 1, 0]);
  assert.equal(JSON.parse(store.data.get("prov/aaaaaaaaaa02")).openOffers, 0, "the other suppliers' places are freed");
  assert.equal((await post(quote, { t: r.track, action: "received", rating: 4 })).statusCode, 409);
  const rec2 = JSON.parse(store.data.get(rec.key));
  assert.equal(rec2.orderValue, 23900);
  // bad links
  assert.equal((await get("x".repeat(32))).statusCode, 404);
  assert.equal((await post(quote, { t: r.track, action: "choose", n: 1 }, { ...H, origin: "https://evil.example" })).statusCode, 403);
});

test("no matching supplier: the request waits as new; the owner can send it again after a supplier joins", async () => {
  const store = memory(); lead.setStoreForTests(store); ownerLeads.setStoreForTests(store); usage.setStoreForTests(null);
  const r = json(await post(lead, { ...REQ, city: "Hubballi-Dharwad", pin: "580020" }));
  assert.equal(r.suppliers, 0);
  assert.equal(json(await get(r.track)).status, "new");
  process.env.OWNER_KEY = "owner-key-123456";
  const own = { host: "site", "x-owner-key": "owner-key-123456" };
  assert.equal((await post(ownerProviders, { action: "save", business: "Hubli Steels", phone: "9900000001", city: "Hubballi-Dharwad", pins: "580", categories: ["steel"] }, own)).statusCode, 200);
  const key = [...store.data.keys()].find((k) => k.startsWith("lead/"));
  const res = json(await post(ownerLeads, { key, action: "match" }, own));
  assert.equal(res.lead.offers.length, 1); assert.equal(res.lead.offers[0].business, "Hubli Steels"); assert.equal(res.lead.status, "sent");
  assert.equal(json(await post(ownerLeads, { action: "settings", commissionPct: 2 }, own)).settings.commissionPct, 2);
  assert.equal((await post(ownerLeads, { action: "settings", commissionPct: 90 }, own)).statusCode, 400);
  delete process.env.OWNER_KEY;
});

test("supplier sign-up waits for approval; the owner approves, pauses and deletes", async () => {
  const store = memory(); lead.setStoreForTests(store);
  const s = { business: "Ganesh Traders", name: "Ganesh", phone: "9845011111", city: "Mysuru", pins: "570017, 5700", categories: ["sand", "aggregate", "cement"], agree: true };
  assert.equal((await post(join, { ...s, agree: false })).statusCode, 400);
  assert.equal((await post(join, { ...s, categories: [] })).statusCode, 400);
  assert.equal((await post(join, s)).statusCode, 200);
  assert.equal((await post(join, s)).statusCode, 409, "same number twice");
  const p = JSON.parse([...store.data.entries()].find(([k]) => k.startsWith("prov/"))[1]);
  assert.equal(p.approved, false); assert.deepEqual(p.pins, ["570017", "5700"]); assert.deepEqual(p.categories, ["sand", "aggregate"], "no cement");
  assert.equal(M.match({ city: "Mysuru", pin: "570017", items: [{ category: "sand" }] }, [p]).length, 0, "not sent requests before approval");
  process.env.OWNER_KEY = "owner-key-123456";
  const own = { host: "site", "x-owner-key": "owner-key-123456" };
  assert.equal((await ownerProviders.handler({ httpMethod: "GET", headers: { "x-owner-key": "wrong" } })).statusCode, 401);
  await post(ownerProviders, { action: "save", ...p, approved: true }, own);
  assert.equal(JSON.parse(store.data.get(`prov/${p.id}`)).approved, true);
  await post(ownerProviders, { action: "save", ...p, approved: true, active: false }, own);
  assert.equal(M.match({ city: "Mysuru", pin: "570017", items: [{ category: "sand" }] }, [JSON.parse(store.data.get(`prov/${p.id}`))]).length, 0, "paused");
  await post(ownerProviders, { action: "delete", id: p.id }, own);
  assert.ok(!store.data.has(`prov/${p.id}`));
  delete process.env.OWNER_KEY;
});

test("WhatsApp templates go out when set up: the supplier gets the link, the customer hears about quotes, the chosen supplier is told", async () => {
  const store = setup(), sent = [];
  Object.assign(process.env, { WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TEMPLATE_SUPPLIER: "new_request", WHATSAPP_TEMPLATE_CUSTOMER: "quotes_ready", WHATSAPP_TEMPLATE_CHOSEN: "you_were_chosen" });
  wa.setFetchForTests(async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true }; });
  const r = json(await post(lead, REQ));
  assert.deepEqual(sent.map((m) => m.template.name), ["new_request", "new_request", "new_request"]);
  assert.match(sent[0].template.components[0].parameters[1].text, /\/quote\?t=[a-f0-9]{32}$/);
  assert.equal(sent[0].template.components[0].parameters[0].text, "Vijayanagar, Mysuru 570017");
  const rec = JSON.parse([...store.data.entries()].find(([k]) => k.startsWith("lead/"))[1]);
  assert.ok(rec.offers.every((o) => o.notified === true));
  await post(quote, { t: rec.offers[0].token, action: "quote", rates: [68, 1500], delivery: 0, deliveryDate: "2026-12-01" });
  assert.equal(sent.at(-1).template.name, "quotes_ready"); assert.equal(sent.at(-1).to, "919845012345");
  await post(quote, { t: r.track, action: "choose", n: 1 });
  assert.equal(sent.at(-1).template.name, "you_were_chosen");
  for (const k of ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_TEMPLATE_SUPPLIER", "WHATSAPP_TEMPLATE_CUSTOMER", "WHATSAPP_TEMPLATE_CHOSEN"]) delete process.env[k];
});

test("dealer panel: approval gives a personal link; it lists the dealer's requests; pausing stops new ones", async () => {
  const store = memory(); lead.setStoreForTests(store); usage.setStoreForTests(null);
  const panel = require("../netlify/functions/supplier-panel");
  process.env.OWNER_KEY = "owner-key-123456";
  const own = { host: "site", "x-owner-key": "owner-key-123456" };
  await post(ownerProviders, { action: "save", business: "Ganesh Traders", name: "Ganesh", phone: "9845011111", city: "Mysuru", pins: "", categories: ["steel", "sand"] }, own);
  const listed = json(await ownerProviders.handler({ httpMethod: "GET", headers: own })).providers[0];
  assert.match(listed.panelToken, /^[a-f0-9]{32}$/);
  assert.equal(listed.requests, undefined, "the request list stays on the dealer's panel, not the owner list");
  const k = listed.panelToken;
  const view = (key) => panel.handler({ httpMethod: "GET", headers: H, queryStringParameters: { k: key } });
  let d = json(await view(k));
  assert.equal(d.profile.business, "Ganesh Traders"); assert.equal(d.requests.length, 0); assert.equal(d.profile.active, true);
  // a request arrives → it shows on the panel, then the quote is reflected
  json(await post(lead, REQ));
  d = json(await view(k));
  assert.equal(d.requests.length, 1); assert.equal(d.requests[0].status, "sent"); assert.equal(d.stats.toQuote, 1);
  assert.ok(!JSON.stringify(d).includes("9845012345"), "no customer contact on the panel before being chosen");
  await post(quote, { t: d.requests[0].token, action: "quote", rates: [68, 1500], delivery: 0, deliveryDate: "2026-12-01" });
  d = json(await view(k));
  assert.equal(d.requests[0].status, "quoted"); assert.equal(d.requests[0].total, 23400); assert.equal(d.stats.quoted, 1);
  // pause → no new requests
  d = json(await panel.handler({ httpMethod: "POST", headers: H, body: JSON.stringify({ k, action: "pause" }) }));
  assert.equal(d.profile.active, false);
  assert.equal(json(await post(lead, REQ)).suppliers, 0);
  // bad link, and the link stops working when the dealer is deleted
  assert.equal((await view("0".repeat(32))).statusCode, 404);
  await post(ownerProviders, { action: "delete", id: listed.id }, own);
  assert.equal((await view(k)).statusCode, 404);
  delete process.env.OWNER_KEY;
});
