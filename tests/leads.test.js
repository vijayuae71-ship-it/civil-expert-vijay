"use strict";
// Material delivery requests (India, non-cement): extraction, the request, the owner list and WhatsApp.
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
process.env.WHATSAPP_APP_SECRET = "test-secret";
process.env.WHATSAPP_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "12345";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const L = require("../assets/leads.js");
const lead = require("../netlify/functions/lead");
const ownerLeads = require("../netlify/functions/owner-leads");
const usage = require("../netlify/functions/usage-stats");
const { fakeClaude } = require("./helpers");
const chat = require("../netlify/functions/chat");
const wa = require("../netlify/functions/whatsapp");

const memory = () => {
  const data = new Map();
  return { data, get: async (k, o) => (data.has(k) ? (o?.type === "json" ? JSON.parse(data.get(k)) : data.get(k)) : null), set: async (k, v) => { data.set(k, String(v)); }, setJSON: async (k, v) => { data.set(k, JSON.stringify(v)); }, delete: async (k) => { data.delete(k); }, list: async ({ prefix = "" } = {}) => ({ blobs: [...data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }) };
};
const BOQ = "| Sl | Description | Unit | Qty | Rate | Amount |\n|---|---|---|---|---|---|\n| 1 | TMT steel Fe500D 12 mm | kg | 300 | 70 | 21000 |\n| 2 | OPC 53 cement | bag | 12 | 380 | 4560 |\n| 3 | M-sand | m³ | 2 | 1500 | 3000 |\n| 4 | Excavation in soil | cum | 20 | 300 | 6000 |\n| 5 | Solid concrete blocks 200 mm | nos | 800 | 45 | 36000 |\n| 6 | Brick masonry 230 mm in CM 1:6 | m³ | 12 | 6000 | 72000 |\n| 7 | RCC M25 slab | m³ | 10 | 7000 | 70000 |\n| 8 | Ready mix concrete M20 | m³ | 5 | 6000 | 30000 |";

test("materials are picked from BOQ tables and plain answers; cement, concrete and work items are left out", () => {
  assert.deepEqual(L.fromText(BOQ).map((x) => [x.name, x.qty, x.unit, x.category]), [
    ["TMT steel Fe500D 12 mm", 300, "kg", "steel"], ["M-sand", 2, "m³", "sand"], ["Solid concrete blocks 200 mm", 800, "nos", "blocks"]]);
  const plain = L.fromText("**You need about 31 kg cement (about 0.6 bag) and about 0.13 m³ sand (about 4.5 cft).**\n- Paint: 10.5 litres\n- Tile adhesive: 80 kg");
  assert.deepEqual(plain.map((x) => [x.category, x.qty, x.unit]), [["sand", 0.13, "m³"], ["paint", 10.5, "litres"], ["tiles", 80, "kg"]]);
  assert.equal(L.categoryOf("OPC 53 cement", "bags"), null);
  assert.equal(L.categoryOf("Brick masonry 230 mm", "m³"), null, "a work item in m³ is not a number of bricks");
  assert.equal(L.categoryOf("Bricks", "nos"), "bricks");
  assert.equal(L.categoryOf("Concrete blocks", "nos"), "blocks", "concrete blocks are not concrete");
  assert.equal(L.fromText("Curing takes 7 days.").length, 0);
});

test("calculator results become a materials list", () => {
  assert.deepEqual(L.fromCalc("brickwork", [["Bricks", "1050 (incl. 5% wastage)"], ["Cement", "2.1 bags (105 kg)"], ["Sand", "0.512 m³ (18.1 cft)"]]).map((x) => [x.name, x.qty, x.unit]),
    [["Bricks", 1050, "nos"], ["Sand (M-sand / river sand)", 0.51, "m³"]]);
  assert.deepEqual(L.fromCalc("steel", [["Total for 10 × 12 m", "106.7 kg (0.107 t)"]], { diaMm: "12" })[0], { name: "TMT steel 12 mm", qty: 107, unit: "kg", category: "steel" });
  assert.equal(L.fromCalc("concrete", [["Net volume", "2 m³"]]).length, 0, "concrete is cement-based: not offered");
  assert.equal(L.fromCalc("ac", [["Suggested AC size", "1.5 TR"]]).length, 0);
});

test("a request needs a material, an Indian mobile, a PIN, a city and consent; cement is dropped", () => {
  const ok = { items: [{ name: "M-sand", qty: 2, unit: "m³" }, { name: "OPC cement", qty: 10, unit: "bags" }], city: "Mysuru", pin: "570017", phone: "+91 98450 12345", consent: true };
  const c = L.clean(ok);
  assert.deepEqual(c.items, [{ name: "M-sand", qty: 2, unit: "m³", category: "sand" }]);
  assert.equal(c.phone, "+919845012345");
  assert.throws(() => L.clean({ ...ok, consent: false }), /tick the box/);
  assert.throws(() => L.clean({ ...ok, phone: "12345" }), /10-digit Indian mobile/);
  assert.throws(() => L.clean({ ...ok, pin: "57001" }), /6-digit PIN/);
  assert.throws(() => L.clean({ ...ok, items: [{ name: "OPC cement", qty: 10 }] }), /at least one material/);
  assert.match(L.message({ ...c, area: "Vijayanagar", neededBy: "2026-12-01", role: "Contractor / builder" }), /^\*Material delivery request\* — Mysuru, Vijayanagar 570017\nNeeded by: 2026-12-01\n\n1\. M-sand — 2 m³[\s\S]*Please reply with your price including delivery\.$/);
});

test("the lead endpoint stores a consented request, refuses other sites and limits requests per day", async () => {
  const store = memory(); lead.setStoreForTests(store); usage.setStoreForTests(null);
  const post = (body, origin = "https://site") => lead.handler({ httpMethod: "POST", headers: { host: "site", origin, "x-nf-client-connection-ip": "5.6.7.8" }, body: JSON.stringify(body) });
  const body = { items: [{ name: "TMT steel 12 mm", qty: 300, unit: "kg" }], city: "Bengaluru", pin: "560040", phone: "9845012345", consent: true, source: "ai" };
  const res = await post(body);
  assert.equal(res.statusCode, 200);
  const saved = [...store.data.entries()].find(([k]) => k.startsWith("lead/"));
  const rec = JSON.parse(saved[1]);
  assert.equal(rec.status, "new"); assert.equal(rec.phone, "+919845012345"); assert.equal(rec.key, saved[0]);
  assert.ok(![...store.data.keys()].some((k) => k.includes("5.6.7.8")), "no raw IP stored");
  assert.equal((await post({ ...body, consent: false })).statusCode, 400);
  assert.equal((await post(body, "https://evil.example")).statusCode, 403);
  assert.equal((await lead.handler({ httpMethod: "GET", headers: {} })).statusCode, 405);
  for (let i = 0; i < lead.PER_IP_DAY - 1; i++) assert.equal((await post(body)).statusCode, 200);
  assert.equal((await post(body)).statusCode, 429);
});

test("owner leads: key required; newest first; status and note updated; requests older than 180 days deleted", async () => {
  process.env.OWNER_KEY = "owner-key-123456";
  const store = memory(); ownerLeads.setStoreForTests(store);
  const old = new Date(Date.now() - 200 * 864e5).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
  const put = (day, n) => { const key = `lead/${day}/${n}-${"a".repeat(11)}${n}`; store.data.set(key, JSON.stringify({ key, at: `${day}T10:00:00Z`, status: "new", city: "Mysuru", pin: "570017", items: [], phone: "+919845012345" })); return key; };
  const kOld = put(old, 1), k1 = put(today, 2), k2 = put(today, 3);
  const call = (method, body, key = "owner-key-123456") => ownerLeads.handler({ httpMethod: method, headers: { "x-owner-key": key }, body: body && JSON.stringify(body) });
  assert.equal((await call("GET", null, "nope")).statusCode, 401);
  const list = JSON.parse((await call("GET")).body);
  assert.deepEqual(list.leads.map((l) => l.key), [k2, k1]);
  assert.ok(!store.data.has(kOld), "an old request is deleted");
  const upd = JSON.parse((await call("POST", { key: k1, status: "quoted", note: "Ravi Steels ₹68/kg" })).body);
  assert.equal(upd.lead.status, "quoted"); assert.equal(upd.lead.note, "Ravi Steels ₹68/kg");
  assert.equal((await call("POST", { key: k1, status: "won" })).statusCode, 400);
  assert.equal((await call("POST", { key: "lead/../x", status: "sent" })).statusCode, 400);
  delete process.env.OWNER_KEY;
});

test("WhatsApp: an answer with materials offers delivery; 'delivery' sends a link with the list (no cement)", async () => {
  const sent = [];
  wa.setForTests({ stores: { seen: memory(), conversations: memory() }, fetch: async (url, opts = {}) => { if (url.endsWith("/12345/messages")) { const b = JSON.parse(opts.body); if (b.type === "text") sent.push(b.text.body); } return { ok: true, text: async () => "", json: async () => ({}) }; } });
  chat.setAnswerStoreForTests(null);
  const signed = (text) => {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ from: "919845000001", id: `wamid.${Math.random()}`, timestamp: "1", type: "text", text: { body: text } }] } }] }] });
    return { httpMethod: "POST", headers: { host: "site", "x-hub-signature-256": "sha256=" + crypto.createHmac("sha256", "test-secret").update(body).digest("hex") }, body };
  };
  fakeClaude(chat, `## Recommendation\nHere is the BOQ.\n\n${BOQ}`);
  await wa.handler(signed("BOQ for a 20 m compound wall in Mysuru"));
  assert.match(sent.at(-1), /Reply \*delivery\*/);
  await wa.handler(signed("delivery"));
  const msg = sent.at(-1);
  assert.match(msg, /• TMT steel Fe500D 12 mm — 300 kg/); assert.doesNotMatch(msg, /cement — /i);
  const items = JSON.parse(Buffer.from(new URL(msg.match(/https:\/\/\S+/)[0]).searchParams.get("items"), "base64url").toString("utf8"));
  assert.deepEqual(items.map((x) => x.category), ["steel", "sand", "blocks"]);
});
