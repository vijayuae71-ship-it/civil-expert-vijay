/* Text in any language for jsPDF.
 * jsPDF's built-in fonts only cover Latin letters (Windows-1252) and cannot shape Indian scripts
 * (joined letters, vowel signs), so Tamil, Hindi, Kannada, Arabic and other text turns into junk such
 * as "®Á±Í±¤Í¤¿". For such text the phone itself draws the words (with its own fonts, which shape
 * them correctly) onto a canvas, and that picture goes into the PDF.
 *   PdfText.needsPicture(text)                    → true when jsPDF cannot write it
 *   PdfText.picture(text, widthPt, { size, color, bold, lineGap }) → { data, w, h } (PNG, in pt)
 */
(function (root) {
  "use strict";
  // Characters jsPDF's standard fonts can write: Latin-1 plus the Windows-1252 extras (– — ‘ ’ “ ” • … € ™).
  const PLAIN = /^[\u0000-ÿ–—‘’‚“”„†‡•…‰‹›€™ŒœŠšŸŽžƒˆ˜]*$/;
  const needsPicture = (text) => !PLAIN.test(String(text == null ? "" : text));
  const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
  const FONTS = '"Noto Sans", "Noto Sans Tamil", "Noto Sans Devanagari", "Noto Sans Kannada", "Noto Sans Telugu", "Noto Sans Malayalam", "Noto Sans Bengali", "Noto Sans Gujarati", "Noto Sans Gurmukhi", "Noto Sans Sinhala", "Noto Naskh Arabic", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", sans-serif';

  // Wrap to the width: by words, and inside a word that is too long (or text without spaces,
  // such as Chinese) by characters.
  function wrap(cx, text, maxW) {
    const lines = [];
    for (const para of String(text).split(/\n/)) {
      let line = "";
      const push = (w) => {
        const t = line ? `${line} ${w}` : w;
        if (cx.measureText(t).width <= maxW || !line) {
          if (cx.measureText(t).width <= maxW) { line = t; return; }
          // a single word wider than the line: break it by characters
          let part = "";
          for (const ch of Array.from(w)) { if (cx.measureText(part + ch).width > maxW && part) { lines.push(part); part = ch; } else part += ch; }
          line = part; return;
        }
        lines.push(line); line = ""; push(w);
      };
      for (const w of para.split(/\s+/).filter(Boolean)) push(w);
      lines.push(line);
    }
    while (lines.length > 1 && !lines[lines.length - 1]) lines.pop();
    return lines;
  }

  function picture(text, widthPt, { size = 10, color = "#1e293b", bold = false, lineGap = 1.4 } = {}) {
    const scale = 3, px = size * scale, cv = document.createElement("canvas"), cx = cv.getContext("2d");
    const font = `${bold ? "bold " : ""}${px}px ${FONTS}`;
    cx.font = font;
    const maxW = Math.max(10, widthPt * scale), lines = wrap(cx, text, maxW), lineH = px * lineGap;
    cv.width = Math.ceil(maxW); cv.height = Math.max(1, Math.ceil(lines.length * lineH + px * 0.35));
    cx.font = font; cx.fillStyle = color; cx.textBaseline = "top";
    const rtl = RTL.test(text);
    if (rtl) { cx.direction = "rtl"; cx.textAlign = "right"; }
    lines.forEach((l, i) => cx.fillText(l, rtl ? cv.width : 0, i * lineH + px * 0.15));
    return { data: cv.toDataURL("image/png"), w: widthPt, h: cv.height / scale };
  }

  const api = { needsPicture, picture, wrap };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PdfText = api;
})(typeof self !== "undefined" ? self : this);
