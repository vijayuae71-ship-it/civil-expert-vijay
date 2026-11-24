"use strict";
// Serves a tender or price list forwarded to the WhatsApp bot to the Quotation page (?wa=<id>).
// The id is secret and long; files are kept for 7 days (see whatsapp.js).
const IMPORT_DAYS = 7;
let storeOverride;
function setStoreForTests(store) { storeOverride = store; }

function openStore(event) {
  if (storeOverride !== undefined) return storeOverride;
  try {
    const { getStore, connectLambda } = require("@netlify/blobs");
    if (event?.blobs) connectLambda(event);
    return getStore("wa-imports");
  } catch { return null; }
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
  const fail = (statusCode, error) => ({ statusCode, headers, body: JSON.stringify({ error }) });
  if (event.httpMethod !== "GET") return fail(405, "Method Not Allowed");
  const id = String(event.queryStringParameters?.id || "");
  if (!/^\d{13}-[A-Za-z0-9_-]{24}$/.test(id)) return fail(400, "This link is not valid.");
  if (Date.now() - Number(id.split("-")[0]) > IMPORT_DAYS * 864e5) return fail(410, "This link has expired (7 days). Forward the file to the WhatsApp bot again.");
  const store = openStore(event);
  if (!store) return fail(503, "Please try again in a minute.");
  let file = null;
  try { file = await store.get(`f/${id}`, { type: "json" }); } catch (e) { console.error("Import read failed:", e?.name || e); }
  if (!file?.data) return fail(404, "This file is no longer available. Forward it to the WhatsApp bot again.");
  return { statusCode: 200, headers, body: JSON.stringify({ kind: file.kind === "prices" ? "prices" : "tender", name: file.name, mimeType: file.mimeType, data: file.data }) };
};

module.exports = Object.assign(module.exports, { setStoreForTests });
