"use strict";
// Background version of chat.js for full itemised BOQs, which take longer to write than a normal
// request may run. chat-start.js stores the question (with any photos or drawings) and starts this
// with just the job id, because Netlify passes at most 256 KB to a background function. This runs
// for up to 15 minutes and saves the answer for chat-status.js. The same checks as chat.js apply
// (origin, rate limit, cache), using the original request's headers.
const chat = require("./chat");
const { isJobId, requestKey, openJobStore } = require("./chat-jobs");

let storeOverride; // tests inject a fake store
function setJobStoreForTests(store) { storeOverride = store; }

exports.handler = async (event) => {
  let jobId;
  try { jobId = JSON.parse(event.body || "{}").jobId; } catch {}
  if (!isJobId(jobId)) return { statusCode: 400 };
  const store = storeOverride !== undefined ? storeOverride : openJobStore(event);
  if (!store) { console.error("Job store unavailable"); return { statusCode: 500 }; }
  const save = (value) => store.setJSON(jobId, { ...value, at: Date.now() }).catch((e) => console.error("Job save failed:", e?.name || e));

  let request = null;
  try { request = await store.get(requestKey(jobId), { type: "json" }); } catch (e) { console.error("Job request read failed:", e?.name || e); }
  if (!request?.body) return { statusCode: 404 };   // unknown or already handled
  await store.delete(requestKey(jobId)).catch(() => {});

  let result;
  try {
    const res = await chat.run({ httpMethod: "POST", headers: request.headers || {}, body: request.body, blobs: event.blobs }, { background: true });
    const body = JSON.parse(res.body || "{}");
    result = res.statusCode === 200 && body.reply ? { status: "done", ...body } : { status: "error", error: body.error || "The AI expert could not answer. Please try again." };
  } catch (error) {
    console.error("Background chat failed:", error?.name || error);
    result = { status: "error", error: "The AI expert could not answer. Please try again." };
  }
  await save(result);
  return { statusCode: 200 };
};

module.exports = Object.assign(module.exports, { setJobStoreForTests });
