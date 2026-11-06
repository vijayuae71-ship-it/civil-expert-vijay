"use strict";

// Turns the expert's Markdown answer into WhatsApp text and splits long answers.
// WhatsApp supports *bold*, _italic_, `code` and plain lines, but no tables or headings.

const MAX_MESSAGE_CHARS = 3800; // WhatsApp's limit is 4,096; keep a margin

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

function toWhatsApp(markdown) {
  const out = [];
  let tableHeader = null;
  for (const raw of String(markdown || "").replace(/\r/g, "").split("\n")) {
    let line = raw;
    if (isDivider(line)) continue;
    if (isTableRow(line)) {
      const row = cells(line).map((c) => c.replace(/\*\*/g, ""));
      if (!tableHeader) { tableHeader = row; continue; }       // header row is dropped, rows read on their own
      const parts = row.filter((c) => c && c !== "—" && c !== "-");
      if (parts.length) out.push(`• ${parts.join(" · ")}`);
      continue;
    }
    tableHeader = null;
    if (/^\s*#{1,6}\s+/.test(line)) line = `*${line.replace(/^\s*#{1,6}\s+/, "").replace(/\*\*/g, "").trim()}*`;
    else if (/^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(line)) line = `*${line.replace(/\*\*/g, "").trim()}*`;
    line = line
      .replace(/\*\*([^*]+)\*\*/g, "*$1*")           // **bold** → *bold*
      .replace(/^(\s*)[-*]\s+/, "$1• ")              // - item → • item
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)");
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Split at paragraph, then line, boundaries so no message passes the limit.
function splitMessages(text, max = MAX_MESSAGE_CHARS) {
  const chunks = [];
  let current = "";
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = ""; };
  for (const para of String(text).split(/\n\n/)) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length <= max) { current = candidate; continue; }
    push();
    if (para.length <= max) { current = para; continue; }
    for (const line of para.split("\n")) {
      const next = current ? `${current}\n${line}` : line;
      if (next.length <= max) { current = next; continue; }
      push();
      for (let i = 0; i < line.length; i += max) chunks.push(line.slice(i, i + max));
    }
  }
  push();
  return chunks;
}

module.exports = { toWhatsApp, splitMessages, MAX_MESSAGE_CHARS };
