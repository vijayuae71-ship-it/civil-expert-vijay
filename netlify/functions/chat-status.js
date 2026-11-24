"use strict";
// The page polls this for a background answer (see chat-background.js).
const { isJobId, openJobStore, MAX_AGE_MS } = require("./chat-jobs");

let storeOverride;
function setJobStoreForTests(store) { storeOverride = store; }

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const id = event.queryStringParameters?.id;
  if (!isJobId(id)) return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown request." }) };
  const store = storeOverride !== undefined ? storeOverride : openJobStore(event);
  if (!store) return { statusCode: 503, headers, body: JSON.stringify({ error: "Please try again." }) };
  let job = null;
  try { job = await store.get(id, { type: "json" }); } catch (e) { console.error("Job read failed:", e?.name || e); }
  if (!job) return { statusCode: 200, headers, body: JSON.stringify({ status: "pending" }) };
  if (job.status === "working" && Date.now() - job.at > MAX_AGE_MS) return { statusCode: 200, headers, body: JSON.stringify({ status: "error", error: "This answer took too long. Please try again." }) };
  if (job.status === "done" || job.status === "error") await store.delete(id).catch(() => {});
  const { at, ...rest } = job;
  return { statusCode: 200, headers, body: JSON.stringify(rest) };
};

module.exports = Object.assign(module.exports, { setJobStoreForTests });
