"use strict";
// Starts a long answer (full BOQ). Netlify passes at most 256 KB to a background function, but a
// question with photos or drawings is up to 6 MB. So this normal function keeps the whole request
// in Blobs and starts chat-background.js with only the job id. The page then polls chat-status.js.
const { isAllowedOrigin } = require("./rate-limit");
const { isJobId, openJobStore, requestKey } = require("./chat-jobs");

let storeOverride, triggerOverride; // tests inject fakes
function setForTests({ store, trigger } = {}) { storeOverride = store; triggerOverride = trigger; }

// Only what chat.js needs from the original request: the origin check and the rate limit.
const KEEP_HEADERS = ["host", "origin", "referer", "x-nf-client-connection-ip", "x-forwarded-for", "client-ip", "user-agent"];

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  const fail = (statusCode, error) => ({ statusCode, headers, body: JSON.stringify({ error }) });
  if (event.httpMethod !== "POST") return fail(405, "Method Not Allowed");
  if (!isAllowedOrigin(event)) return fail(403, "Requests are accepted only from this website.");
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return fail(400, "Please try again."); }
  if (!isJobId(body.jobId)) return fail(400, "Please refresh the page and try again.");
  if (typeof body.message !== "string" || !body.message.trim()) return fail(400, "Please enter a question.");

  const store = storeOverride !== undefined ? storeOverride : openJobStore(event);
  if (!store) return fail(503, "The service is busy. Please try again.");
  const h = event.headers || {};
  const kept = Object.fromEntries(KEEP_HEADERS.filter((k) => h[k] || h[k.toLowerCase()]).map((k) => [k, h[k] || h[k.toLowerCase()]]));
  try {
    await store.setJSON(requestKey(body.jobId), { body: event.body, headers: kept, at: Date.now() });
    await store.setJSON(body.jobId, { status: "working", at: Date.now() });
  } catch (e) {
    console.error("Job request save failed:", e?.name || e);
    return fail(503, "The service is busy. Please try again.");
  }

  const host = h.host || h.Host;
  const url = `${/^localhost(:\d+)?$/.test(host) ? "http" : "https"}://${host}/.netlify/functions/chat-background`;
  try {
    const trigger = triggerOverride || ((u, init) => fetch(u, init));
    const res = await trigger(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId: body.jobId }) });
    if (res.status !== 202 && !res.ok) throw new Error(`background start ${res.status}`);
  } catch (e) {
    console.error("Background start failed:", e?.message || e);
    await store.delete(requestKey(body.jobId)).catch(() => {});
    await store.delete(body.jobId).catch(() => {});
    return fail(502, "Could not start the BOQ. Please try again.");
  }
  return { statusCode: 202, headers, body: JSON.stringify({ jobId: body.jobId }) };
};

module.exports = Object.assign(module.exports, { setForTests });
