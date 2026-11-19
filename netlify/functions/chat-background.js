"use strict";
// Background version of chat.js for full itemised BOQs, which take longer to write than a normal
// request may run. Netlify answers the page at once (202) and runs this for up to 15 minutes; the
// page then asks chat-status.js for the result. Same checks as chat.js (origin, rate limit, cache).
const chat = require("./chat");
const { isJobId, openJobStore } = require("./chat-jobs");

let storeOverride; // tests inject a fake store
function setJobStoreForTests(store) { storeOverride = store; }

exports.handler = async (event) => {
  let jobId;
  try { jobId = JSON.parse(event.body || "{}").jobId; } catch {}
  if (!isJobId(jobId)) return { statusCode: 400 };
  const store = storeOverride !== undefined ? storeOverride : openJobStore(event);
  if (!store) { console.error("Job store unavailable"); return { statusCode: 500 }; }
  const save = (value) => store.setJSON(jobId, { ...value, at: Date.now() }).catch((e) => console.error("Job save failed:", e?.name || e));

  await save({ status: "working" });
  let result;
  try {
    const res = await chat.run(event, { background: true });
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
