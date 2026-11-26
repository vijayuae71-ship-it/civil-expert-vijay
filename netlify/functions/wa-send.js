"use strict";
// Business-started WhatsApp messages for the material marketplace. WhatsApp only allows these through
// Meta-approved templates (charged per message), so each one is used only when its template name is set:
//   WHATSAPP_TEMPLATE_SUPPLIER  "New material request near {{1}}. Send your rates (no login): {{2}}"
//   WHATSAPP_TEMPLATE_CUSTOMER  "You have {{1}} price quote(s) for your material request. Compare and choose: {{2}}"
//   WHATSAPP_TEMPLATE_CHOSEN    "Your quote was chosen for the request near {{1}}. Customer details and delivery: {{2}}"
// Language: WHATSAPP_TEMPLATE_LANG (default "en"). Without them the owner sends the links from the dashboard.
let fetchImpl = (...a) => fetch(...a);
function setFetchForTests(f) { fetchImpl = f; }
const KINDS = { supplier: "WHATSAPP_TEMPLATE_SUPPLIER", customer: "WHATSAPP_TEMPLATE_CUSTOMER", chosen: "WHATSAPP_TEMPLATE_CHOSEN" };
const enabled = (kind) => Boolean(process.env[KINDS[kind]] && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
async function sendTemplate(kind, phone, params) {
  if (!enabled(kind)) return false;
  const to = String(phone || "").replace(/\D/g, "");
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v23.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: process.env[KINDS[kind]], language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" }, components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text).slice(0, 900) })) }] } })
    });
    if (!res.ok) console.error("WhatsApp template failed:", kind, res.status);
    return res.ok;
  } catch (e) { console.error("WhatsApp template failed:", kind, e?.name || e); return false; }
}
module.exports = { sendTemplate, enabled, setFetchForTests, KINDS };
