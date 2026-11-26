/* "Ask before answering": the AI's short questions before a BOQ, cost, quantity or design answer.
 * The AI replies in this exact form when details that change the answer are missing:
 *   [[ASK]]
 *   To give you an accurate BOQ:            (optional one-line intro)
 *   1. Where is the site? | Bengaluru | Mysuru | Dubai | Other
 *   2. Built-up area? | 600 sq ft | 1000 sq ft | 1500 sq ft
 * The website shows tap-to-answer chips; WhatsApp gets numbered questions (whatsapp.js).
 *   Clarify.parse(text) → null or { intro, questions: [{ q, options: [] }] }
 *   Clarify.answerText(parsed, answers) → the message sent back with the person's answers
 *   Clarify.whatsappText(parsed) → the questions as a WhatsApp message
 */
(function (root) {
  "use strict";
  const MARK = /^\s*\[\[ASK\]\]\s*/;
  const strip = (s) => String(s || "").replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();

  function parse(text) {
    const s = String(text || "");
    if (!MARK.test(s)) return null;
    const lines = s.replace(MARK, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const questions = [], intro = [];
    for (const line of lines) {
      const m = line.match(/^(?:\d+[.)]|[-*•])\s*(.+)$/);
      if (!m) { if (!questions.length) intro.push(strip(line)); continue; }
      const parts = m[1].split("|").map(strip).filter(Boolean);
      if (!parts.length) continue;
      questions.push({ q: parts[0], options: parts.slice(1, 6) });
    }
    if (!questions.length) return null;
    return { intro: intro.join(" "), questions: questions.slice(0, 4) };
  }

  // answers: one string per question (empty = not answered).
  function answerText(parsed, answers) {
    const lines = parsed.questions.map((x, i) => {
      const a = strip((answers || [])[i]);
      return `${i + 1}. ${x.q.replace(/\?$/, "")}: ${a || "not sure — please assume"}`;
    });
    return `My answers:\n${lines.join("\n")}`;
  }

  function whatsappText(parsed) {
    const out = [parsed.intro || "Before I answer, a few quick questions:", ""];
    parsed.questions.forEach((x, i) => out.push(`*${i + 1}. ${x.q}*${x.options.length ? `\n   ${x.options.join(" / ")}` : ""}`));
    out.push("", "Reply with your answers in one message (e.g. *Mysuru, 1000 sq ft, G+1*), or send *quick* for a quick estimate.");
    return out.join("\n");
  }

  const api = { parse, answerText, whatsappText, MARK };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Clarify = api;
})(typeof self !== "undefined" ? self : this);
