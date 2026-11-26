"use strict";
// The owner key check shared by the owner endpoints (owner-stats, owner-settings).
// null = OWNER_KEY not set up (at least 12 characters); true/false = the request's x-owner-key matches.
const crypto = require("crypto");
function keyOk(event) {
  const want = process.env.OWNER_KEY || "";
  const got = String(event.headers?.["x-owner-key"] || event.headers?.["X-Owner-Key"] || "");
  if (want.length < 12) return null;
  const a = crypto.createHash("sha256").update(got).digest(), b = crypto.createHash("sha256").update(want).digest();
  return crypto.timingSafeEqual(a, b);
}
module.exports = { keyOk };
