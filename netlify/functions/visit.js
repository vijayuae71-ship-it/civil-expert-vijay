"use strict";
// One anonymous visit record per device per day (sent by assets/growth.js), for the owner dashboard:
// a random device code, where the device first came from, the page, and whether it is new.
// No names, phone numbers or questions. Stored with the usage records (usage-stats.js).
const usage = require("./usage-stats");
const { isAllowedOrigin } = require("./rate-limit");

const clean = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const done = (statusCode) => ({ statusCode, headers, body: "{}" });
  if (event.httpMethod !== "POST") return done(405);
  // Browsers always send Origin on this request; requests without one are not counted.
  if (!(event.headers?.origin || event.headers?.Origin) || !isAllowedOrigin(event)) return done(403);
  if (String(event.body || "").length > 500) return done(413);
  let b;
  try { b = JSON.parse(event.body || "{}"); } catch { return done(400); }
  if (!b || typeof b !== "object" || !/^[a-f0-9]{16,32}$/.test(String(b.vid || ""))) return done(400);
  await usage.record(event, { kind: "visit", vid: b.vid, isNew: b.isNew === true, ref: clean(b.ref) || "direct", page: clean(b.page) || "home", via: clean(b.via) || undefined });
  return done(204);
};
