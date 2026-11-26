"use strict";
// Owner dashboard → Limits & budget. Private: the request must carry the OWNER_KEY.
// GET  → the limits in force (saved values over the Netlify defaults), the defaults, the allowed ranges,
//        and today's questions and estimated AI spend.
// POST {sitePerDay, perIpPerHour, perIpPerDay, dailyBudgetUsd} → saved; new values apply within a minute.
const { keyOk } = require("./owner-auth");
const limits = require("./rate-limit");

let storeOverride;
function setStoreForTests(store) { storeOverride = store; }

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return reply(405, { error: "Method Not Allowed" });
  const ok = keyOk(event);
  if (ok === null) return reply(503, { error: "Set OWNER_KEY (at least 12 characters) in Netlify → Site configuration → Environment variables, then redeploy." });
  if (!ok) return reply(401, { error: "Wrong owner key." });
  const store = storeOverride !== undefined ? storeOverride : await limits.openStore(event);
  try {
    if (event.httpMethod === "POST") {
      let body;
      try { body = JSON.parse(event.body || "{}"); } catch { return reply(400, { error: "Send the limits as JSON." }); }
      try { await limits.saveLimits(store, body); } catch (e) { return reply(400, { error: e.message }); }
    }
    return reply(200, { limits: await limits.currentLimits(store, { fresh: true }), defaults: limits.DEFAULTS, ranges: limits.RANGES, today: await limits.today(store) });
  } catch (e) {
    console.error("Owner settings failed:", e?.name || e);
    return reply(500, { error: "Could not read or save the limits. Try again." });
  }
};
module.exports = Object.assign(module.exports, { setStoreForTests });
