"use strict";
// Answers a WhatsApp message in the background (Netlify background function, up to 15 minutes), so long
// answers (detailed BOQs, PDFs, photos) are not cut off by the webhook's time limit. whatsapp.js keeps the
// message as a job in the "wa-jobs" store and sends only the job's random id here.
const wa = require("./whatsapp");

exports.handler = async (event) => {
  let id;
  try { id = JSON.parse(event.body || "{}").id; } catch {}
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id)) return { statusCode: 400 };
  const stores = wa.openStores(event);
  if (!stores.jobs) return { statusCode: 500 };
  const job = await stores.jobs.get(`job/${id}`, { type: "json" }).catch(() => null);
  if (!job?.msg?.from) return { statusCode: 404 };   // unknown, or already answered
  await stores.jobs.delete(`job/${id}`).catch(() => {});
  try {
    await wa.processMessage(event, stores, job.msg, { background: true });
  } catch (error) {
    console.error("WhatsApp background error:", error?.message || error);
    await wa.sendText(job.msg.from, "Sorry, something went wrong. Please try again.").catch(() => {});
  }
  return { statusCode: 200 };
};
