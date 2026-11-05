/**
 * CPWD Civil DSR catalogue boundary.
 * Add an item only after it has been transcribed and visually checked against the
 * supplied source page. This file deliberately stores no OCR-derived values.
 */
const catalogue = Object.freeze({
  edition: "CPWD Delhi Schedule of Rates (DSR) 2023 — Civil",
  sourceVolumes: Object.freeze([
    "Schedule of Rates — Volume 1 Civil",
    "Schedule of Rates — Volume 2 Civil"
  ]),
  // Template — copy, fill from the printed DSR page, and check every field by eye:
  // {
  //   itemNumber: "5.1.2",               // exactly as printed
  //   description: "Short description",   // concise, not the full schedule text
  //   unit: "cum",
  //   rate: 1234.56,                       // ₹, base rate without cost index / GST
  //   volume: "Volume 1", page: 123,
  //   keywords: ["pcc", "1:2:4"]           // words users type; ALL must appear to match
  // },
  verifiedItems: Object.freeze([])
});

function normalise(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function requestedReferences(text) {
  return [...new Set((normalise(text).match(/\b\d{1,2}(?:\.\d{1,3}){1,3}\b/g) || []))];
}

// An item matches when the user quotes its number, or uses all of its keywords.
function findVerifiedCivilMatches(text, items = catalogue.verifiedItems) {
  const refs = new Set(requestedReferences(text));
  const normalised = normalise(text);
  return items.filter((item) => refs.has(normalise(item.itemNumber))
    || (Array.isArray(item.keywords) && item.keywords.length > 0 && item.keywords.every((word) => normalised.includes(normalise(word))))).slice(0, 8);
}

function buildCivilCatalogueContext(text) {
  const matches = findVerifiedCivilMatches(text);
  if (!matches.length) {
    return [
      "CPWD CATALOGUE RESULT (authoritative server-side context):",
      `Civil source registered: ${catalogue.edition}.`,
      "No page-verified Civil DSR item matching this request is available in the live catalogue.",
      "Do not state a Civil DSR item number, unit, description, or rate as verified. Use the required CPWD-format quantity table and mark unavailable reference/rate fields exactly: To be verified against applicable CPWD DSR."
    ].join("\n");
  }

  return [
    "CPWD CATALOGUE RESULT (authoritative server-side context):",
    `Civil source registered: ${catalogue.edition}.`,
    "Only the following records may be shown as verified:",
    ...matches.map((item) => `- ${item.itemNumber} | ${item.description} | ${item.unit} | ₹${item.rate} | ${item.volume}, p. ${item.page}`),
    "Check quantity, applicability, project specification, correction slips, leads/lifts, cost index, GST, and tender conditions before final pricing."
  ].join("\n");
}

module.exports = { catalogue, findVerifiedCivilMatches, buildCivilCatalogueContext };
