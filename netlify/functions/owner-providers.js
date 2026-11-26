"use strict";
// Owner dashboard → 🏪 Suppliers. Private: the request must carry the OWNER_KEY.
// GET → all suppliers (pending first) with their stats.
// POST {action:"save", id?, business, name, phone, city, pins, categories, approved, active} → add or edit
// POST {action:"delete", id}
const { keyOk } = require("./owner-auth");
const lead = require("./lead");
const M = require("./market");

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });
  const ok = keyOk(event);
  if (ok === null) return reply(503, { error: "Set OWNER_KEY (at least 12 characters) in Netlify, then redeploy." });
  if (!ok) return reply(401, { error: "Wrong owner key." });
  const store = lead.openStore(event);
  if (!store) return reply(503, { error: "Storage is not available. Try again in a minute." });
  try {
    if (event.httpMethod === "POST") {
      let b; try { b = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Send JSON." }); }
      if (b.action === "delete") {
        if (!/^[a-f0-9]{12}$/.test(String(b.id || ""))) return reply(400, { error: "Unknown supplier." });
        await store.delete(`prov/${b.id}`);
      } else if (b.action === "save") {
        let p; try { p = M.cleanProvider(b, { owner: true }); } catch (e) { return reply(400, { error: e.message }); }
        const id = /^[a-f0-9]{12}$/.test(String(b.id || "")) ? b.id : M.newId();
        const cur = await store.get(`prov/${id}`, { type: "json" }).catch(() => null) || { id, joinedAt: new Date().toISOString(), openOffers: 0 };
        await store.setJSON(`prov/${id}`, { ...cur, ...p, id });
      } else return reply(400, { error: "Unknown action." });
    }
    const list = (await lead.loadProviders(store)).sort((a, b) => (a.approved === b.approved ? String(b.joinedAt).localeCompare(String(a.joinedAt)) : a.approved ? 1 : -1));
    return reply(200, { providers: list, categories: require("../../assets/leads.js").CATEGORIES });
  } catch (e) {
    console.error("Owner suppliers failed:", e?.name || e);
    return reply(500, { error: "Could not read the suppliers. Try again." });
  }
};
