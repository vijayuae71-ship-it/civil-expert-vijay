"use strict";

// WhatsApp version of the AI expert (Meta WhatsApp Business Cloud API).
//
// Meta calls this function for every message sent to the business number:
//   GET  — one-time webhook verification (hub.verify_token must match WHATSAPP_VERIFY_TOKEN)
//   POST — incoming messages, signed with X-Hub-Signature-256 (HMAC of the body with WHATSAPP_APP_SECRET)
// Each question is answered by the same chat function as the website (same knowledge, safety rules,
// rate limits and saved answers), formatted for WhatsApp and sent back through the Graph API.
//
// Settings (Netlify environment variables): WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
// WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, optional WHATSAPP_API_VERSION. See docs/WHATSAPP_SETUP.md.

const crypto = require("crypto");
const chat = require("./chat");
const { toWhatsApp, splitMessages } = require("./whatsapp-format");
const { BRAND_NAME } = require("./brand");

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v23.0";
const SITE_URL = process.env.URL || "https://civil-expert-vijay.netlify.app";
const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
const HISTORY_TURNS = 8;
const CONVERSATION_IDLE_MS = 24 * 3600e3;   // after a day of silence, start a fresh conversation
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// ---------- test hooks ----------
let fetchImpl = (...args) => fetch(...args);
let storesOverride; // { seen, conversations } fake Blobs stores in tests
function setForTests({ fetch: f, stores } = {}) { if (f) fetchImpl = f; if (stores !== undefined) storesOverride = stores; }

function openStores(event) {
  if (storesOverride !== undefined) return storesOverride || {};
  try {
    const { getStore, connectLambda } = require("@netlify/blobs");
    if (event?.blobs) connectLambda(event);
    return { seen: getStore("wa-seen"), conversations: getStore("wa-conversations") };
  } catch {
    return {};
  }
}

// Phone numbers are never stored: keys are an HMAC of the number with the app secret
// (a plain hash of a phone number could be reversed by trying every number).
const userKey = (waId) => crypto.createHmac("sha256", process.env.WHATSAPP_APP_SECRET || "unset").update(`wa:${waId}`).digest("hex").slice(0, 32);

// ---------- signature ----------
function rawBody(event) {
  return event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : String(event.body || "");
}
function validSignature(event, body) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return false;
  const header = event.headers?.["x-hub-signature-256"] || event.headers?.["X-Hub-Signature-256"] || "";
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Graph API ----------
const graphUrl = (path) => `https://graph.facebook.com/${API_VERSION}/${path}`;
const authHeaders = () => ({ Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` });

async function graphPost(path, payload) {
  const res = await fetchImpl(graphUrl(path), { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) console.error("WhatsApp send failed:", res.status, await res.text().catch(() => ""));
  return res.ok;
}

async function sendText(to, body, replyTo) {
  const parts = splitMessages(body);
  for (const [i, part] of parts.entries()) {
    await graphPost(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp", recipient_type: "individual", to, type: "text",
      ...(i === 0 && replyTo ? { context: { message_id: replyTo } } : {}),
      text: { preview_url: false, body: part }
    });
  }
}

// Blue ticks + "typing…" while the answer is prepared. Failures are harmless.
async function markReadAndTyping(messageId) {
  try {
    await graphPost(`${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, { messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } });
  } catch {}
}

async function downloadMedia(mediaId) {
  const metaRes = await fetchImpl(graphUrl(mediaId), { headers: authHeaders() });
  if (!metaRes.ok) throw new Error(`media lookup ${metaRes.status}`);
  const meta = await metaRes.json();
  if (Number(meta.file_size) > MAX_MEDIA_BYTES) return { tooLarge: true };
  const fileRes = await fetchImpl(meta.url, { headers: authHeaders() });
  if (!fileRes.ok) throw new Error(`media download ${fileRes.status}`);
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) return { tooLarge: true };
  return { mimeType: String(meta.mime_type || "").split(";")[0].trim(), data: buffer.toString("base64") };
}

// ---------- conversation memory (per user, hashed number) ----------
async function loadConversation(store, key) {
  if (!store) return { turns: [], audience: "worker", isNew: false };
  try {
    const saved = await store.get(key, { type: "json" });
    const audience = saved?.audience === "engineer" ? "engineer" : "worker";
    if (!saved) return { turns: [], audience, isNew: true };
    if (Date.now() - Date.parse(saved.updatedAt || 0) > CONVERSATION_IDLE_MS) return { turns: [], audience, isNew: false };
    return { turns: Array.isArray(saved.turns) ? saved.turns : [], audience, isNew: false };
  } catch { return { turns: [], audience: "worker", isNew: false }; }
}
async function saveConversation(store, key, conversation) {
  if (!store) return;
  try { await store.setJSON(key, { audience: conversation.audience, turns: conversation.turns.slice(-HISTORY_TURNS), updatedAt: new Date().toISOString() }); } catch {}
}

// Meta retries a webhook it thinks failed; answer each message id once.
async function firstTimeSeen(store, messageId) {
  if (!store) return true;
  try {
    if (await store.get(messageId)) return false;
    await store.set(messageId, new Date().toISOString());
  } catch {}
  return true;
}

// ---------- messages ----------
const WELCOME = [
  `👷 *${BRAND_NAME}* — construction help on WhatsApp`,
  "",
  "Ask any site question in your own language (हिंदी, اردو, മലയാളം, தமிழ், বাংলা, नेपाली, English…). You can also send a 📷 photo of the problem.",
  "",
  "*Examples*",
  "• Cement and sand for 100 sq ft of 12 mm plaster?",
  "• When can I remove slab props?",
  "• MCB trips when the water heater is on",
  "",
  "*Commands*: *new* – start fresh · *detailed* – engineer answers · *simple* – short steps · *consult* – request a review by a senior engineer",
  "",
  "⚠️ General guidance only. Check design, testing and approvals with your engineer."
].join("\n");

function command(text) {
  const t = String(text || "").trim().toLowerCase().replace(/[!.?]+$/, "");
  if (/^(hi|hello|hey|start|menu|help|salam|namaste|नमस्ते)$/.test(t)) return "welcome";
  if (/^(new|reset|restart|clear)$/.test(t)) return "new";
  if (/^(detailed|engineer|detail)$/.test(t)) return "detailed";
  if (/^(simple|worker|short)$/.test(t)) return "simple";
  if (/^(consult|contact|expert|review|expert review)$/.test(t)) return "consult";
  return null;
}

async function handleMessage(event, stores, msg) {
  const from = msg.from;
  const key = userKey(from);
  const conversation = await loadConversation(stores.conversations, key);

  let text = "", attachment = null;
  if (msg.type === "text") text = msg.text?.body || "";
  else if (msg.type === "image" || msg.type === "document") {
    const media = msg[msg.type] || {};
    text = media.caption || (msg.type === "image" ? "Please look at this site photo and tell me what you see and what to do." : "Please review this document.");
    await markReadAndTyping(msg.id);
    const file = await downloadMedia(media.id).catch((e) => { console.error("WhatsApp media error:", e.message); return null; });
    if (!file) return sendText(from, "Sorry, I could not open that file. Please send it again.", msg.id);
    if (file.tooLarge) return sendText(from, "That file is larger than 4 MB. Please send a smaller photo or only the pages you need.", msg.id);
    const ok = IMAGE_TYPES.has(file.mimeType) || file.mimeType === "application/pdf" || file.mimeType === "text/plain" || file.mimeType === "text/csv";
    if (!ok) return sendText(from, "I can read photos (JPEG/PNG), PDF, CSV and TXT files. For Excel or PowerPoint, please send a PDF or a screenshot.", msg.id);
    attachment = { name: media.filename || `whatsapp-${msg.type}.${file.mimeType.split("/")[1] || "bin"}`, mimeType: file.mimeType, data: file.data };
  } else if (msg.type === "audio") {
    return sendText(from, "🎤 Voice notes are not supported yet. Please type your question (tip: use your phone keyboard's mic button to speak and it will type for you), or send a photo.", msg.id);
  } else {
    return sendText(from, "Please send your question as a text message or a photo.", msg.id);
  }

  switch (command(text)) {
    case "welcome": if (conversation.isNew) await saveConversation(stores.conversations, key, conversation); return sendText(from, WELCOME);
    case "new": await saveConversation(stores.conversations, key, { turns: [], audience: conversation.audience }); return sendText(from, "✅ Started a fresh conversation. Ask your question.");
    case "detailed": await saveConversation(stores.conversations, key, { ...conversation, audience: "engineer" }); return sendText(from, "📐 Detailed answers are on (calculations and full working). Send *simple* to switch back.");
    case "simple": await saveConversation(stores.conversations, key, { ...conversation, audience: "worker" }); return sendText(from, "🛠️ Simple step-by-step answers are on. Send *detailed* for engineer answers.");
    case "consult": return sendText(from, `To request a personal review of your project by a senior engineer, fill this short form:\n${SITE_URL}/expert#consult`);
    default: break;
  }

  // First message ever from this number: send the guide (commands, languages), then answer.
  if (conversation.isNew) await sendText(from, WELCOME);
  if (!attachment) await markReadAndTyping(msg.id);

  const response = await chat.handler({
    httpMethod: "POST",
    blobs: event.blobs,
    headers: { host: event.headers?.host || "whatsapp", "x-nf-client-connection-ip": `wa-${key}` },
    body: JSON.stringify({ message: text.slice(0, 4000), history: conversation.turns, attachment, language: "auto", audience: conversation.audience, channel: "whatsapp" })
  });
  let data = {};
  try { data = JSON.parse(response.body); } catch {}
  if (response.statusCode !== 200 || !data.reply) return sendText(from, data.error || "Sorry, I could not answer right now. Please try again in a minute.", msg.id);

  await sendText(from, toWhatsApp(data.reply), msg.id);
  conversation.turns.push({ role: "user", text: attachment ? `${text}\n[${msg.type} attached]` : text }, { role: "model", text: data.reply });
  await saveConversation(stores.conversations, key, conversation);
}

exports.handler = async (event) => {
  // Webhook verification when the URL is first saved in Meta's dashboard.
  if (event.httpMethod === "GET") {
    const q = event.queryStringParameters || {};
    if (q["hub.mode"] === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && q["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) {
      return { statusCode: 200, headers: { "Content-Type": "text/plain" }, body: String(q["hub.challenge"] || "") };
    }
    return { statusCode: 403, body: "Forbidden" };
  }
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  const body = rawBody(event);
  if (!validSignature(event, body)) return { statusCode: 401, body: "Invalid signature" };
  if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    console.error("WhatsApp is not configured: set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.");
    return { statusCode: 200, body: "ok" };
  }

  let payload;
  try { payload = JSON.parse(body); } catch { return { statusCode: 400, body: "Bad JSON" }; }
  const stores = openStores(event);
  const messages = (payload.entry || []).flatMap((e) => (e.changes || []).flatMap((c) => c.value?.messages || []));

  // Always answer 200 so Meta does not resend; delivery receipts ("statuses") are ignored.
  for (const msg of messages) {
    if (!msg?.id || !msg.from) continue;
    if (!(await firstTimeSeen(stores.seen, msg.id))) continue;
    console.log(JSON.stringify({ type: "whatsapp_message", kind: msg.type, user: userKey(msg.from).slice(0, 8) }));
    try { await handleMessage(event, stores, msg); }
    catch (error) {
      console.error("WhatsApp handling error:", error?.message || error);
      await sendText(msg.from, "Sorry, something went wrong. Please try again.").catch(() => {});
    }
  }
  return { statusCode: 200, body: "ok" };
};

exports.setForTests = setForTests;
exports.command = command;
exports.userKey = userKey;
exports.WELCOME = WELCOME;
