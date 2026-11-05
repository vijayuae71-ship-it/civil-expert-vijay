"use strict";

// Code-referenced engineering rules supplied to the model only when a question
// matches. Each entry cites its source so answers can say where a figure comes from.
// Keep entries short, factual and sourced; never add unverified rates here.
// To add an entry: give it an id, keyword regex, source and 2–6 short lines.

const REFERENCES = [
  {
    id: "exposure-durability",
    match: /\b(exposure|durability|cover|minimum cement|max(imum)?\s*w\/?c|w\/c ratio|water[- ]cement ratio|chloride|coastal|marine)\b/i,
    source: "IS 456:2000 Table 5 (RCC) and Table 16 (nominal cover)",
    lines: [
      "Minimum cement content / maximum free w/c / minimum grade for RCC: Mild 300 kg/m³, 0.55, M20; Moderate 300, 0.50, M25; Severe 320, 0.45, M30; Very severe 340, 0.45, M35; Extreme 360, 0.40, M40.",
      "Minimum cement content includes mineral admixtures (fly ash, GGBS, silica fume) counted as cementitious.",
      "Nominal cover to all reinforcement: Mild 20 mm; Moderate 30 mm; Severe 45 mm; Very severe 50 mm; Extreme 75 mm (Severe and Very severe may reduce by 5 mm for M35 and above).",
      "UAE coastal/sub-soil work is commonly specified to project durability specifications (e.g. Dubai Municipality / client specs) that may be stricter; the project specification governs."
    ]
  },
  {
    id: "cube-sampling",
    match: /\b(cube|sampl(e|ing)|testing frequency|how many (cubes|samples)|acceptance criteria|compressive strength test)\b/i,
    source: "IS 456:2000 clauses 15.2.2 and 16.1 (Table 11)",
    lines: [
      "Sampling frequency per grade per pour: 1–5 m³ → 1 sample; 6–15 m³ → 2; 16–30 m³ → 3; 31–50 m³ → 4; 51 m³ and above → 4 plus 1 per additional 50 m³ or part.",
      "One sample = 3 cubes; the test result is the average of the 3 (individual variation within ±15% of the average).",
      "Acceptance (M20 and above, Table 11 as amended): mean of any 4 non-overlapping consecutive results ≥ fck + 0.825 × established SD (rounded off to the nearest 0.5 MPa) or ≥ fck + 3 MPa, whichever is greater; and any individual result ≥ fck − 4 MPa. Confirm the amendment in force and any stricter project specification.",
      "Additional 7-day cubes are commonly cast for early indication; the 28-day result governs acceptance unless specified otherwise."
    ]
  },
  {
    id: "formwork-striking",
    match: /\b(formwork|shuttering|striking|de-?shutter|props?|remove (the )?(form|shuttering|props))\b/i,
    source: "IS 456:2000 clause 11.3.1 (OPC, normal curing, ambient > 15 °C)",
    lines: [
      "Vertical formwork to columns, walls, beams: 16–24 h.",
      "Soffit formwork to slabs (props left under): 3 days. Soffit formwork to beams (props left under): 7 days.",
      "Props to slabs: span up to 4.5 m → 7 days; over 4.5 m → 14 days. Props to beams and arches: span up to 6 m → 14 days; over 6 m → 21 days.",
      "Periods increase with PPC, fly ash or GGBS, low temperatures or early loading; the responsible engineer decides striking on site."
    ]
  },
  {
    id: "curing",
    match: /\b(cur(e|ing)|curing compound|wet curing|how long.*cur)\b/i,
    source: "IS 456:2000 clause 13.5.1",
    lines: [
      "Exposed surfaces kept continuously moist for at least 7 days with OPC concrete.",
      "At least 10 days where mineral admixtures or blended cements are used; extend to at least 10 days (OPC) and 14 days (blended) in dry and hot weather.",
      "Curing compounds are acceptable where approved; apply immediately after finishing/bleed water evaporation at the supplier's coverage rate.",
      "High-strength mixes with silica fume are especially prone to plastic shrinkage: start curing immediately (fogging, evaporation retarder, wet hessian)."
    ]
  },
  {
    id: "hot-weather",
    match: /\b(hot weather|summer|temperature of concrete|concrete temperature|chilled water|ice|uae heat|dubai summer)\b/i,
    source: "IS 7861 (Part 1):1975 and ACI 305R; UAE project specifications",
    lines: [
      "Common specification limit: fresh concrete temperature at placement not above 32 °C (many UAE specifications); check the project specification.",
      "Controls: chilled water or flaked ice as part of mixing water, shaded/sprinkled aggregate stockpiles, retarding admixture, night or early-morning pours, minimal transit time.",
      "Protect against rapid evaporation (wind breaks, fogging, evaporation retarders) and begin curing immediately after finishing."
    ]
  },
  {
    id: "transit-mixer-planning",
    match: /\b(transit mixers?|tm count|number of (trucks|mixers)|fleet|round trip|pour rate|pour planning|truck cycle)\b/i,
    source: "Standard RMC dispatch planning method",
    lines: [
      "Number of transit mixers = ceiling[(required pour rate, m³/h × round-trip cycle time, h) ÷ TM capacity, m³].",
      "Cycle time = loading + travel to site + waiting/queue + discharge + washout + return; add 10–20% contingency for traffic and site delays.",
      "Required pour rate = total volume ÷ planned pour duration, limited by the slowest of: batching plant practical output, pump output and placing/compaction crew.",
      "Worked example: 300 m³ in 8 h → 37.5 m³/h; 40 min (0.67 h) cycle; 9 m³ TMs → 37.5 × 0.67 ÷ 9 = 2.8 → 3 TMs, plus 1 standby = 4."
    ]
  },
  {
    id: "plant-pump-output",
    match: /\b(batching plant|plant capacity|plant output|m3\/h|m³\/h|concrete pump|boom pump|line pump|pump output)\b/i,
    source: "General RMC plant practice (manufacturer ratings are theoretical)",
    lines: [
      "Practical batching plant output is typically 60–75% of rated capacity after cycle losses, truck changeover and QC checks.",
      "Practical pump placement rates are typically far below rated output: plan with the observed site rate (crew, access, boom moves), not the catalogue figure.",
      "Size the plant and fleet to the governing constraint and keep a cold-joint plan for continuous pours (retarder, standby pump/TM)."
    ]
  },
  {
    id: "nominal-mix-materials",
    match: /\b(nominal mix|1\s*:\s*1\.5\s*:\s*3|1\s*:\s*2\s*:\s*4|bags? of cement|cement bags|how much cement|dry volume)\b/i,
    source: "IS 456:2000 Table 9 (nominal mixes) and standard dry-volume method",
    lines: [
      "Nominal mixes (per 50 kg cement): M5 1:5:10, M7.5 1:4:8, M10 1:3:6, M15 1:2:4, M20 1:1.5:3 — design mixes are preferred for M20 and above.",
      "Dry volume ≈ 1.54 × wet volume (some practice uses 1.52–1.57). Cement volume = dry volume × cement part ÷ sum of parts; 1 m³ cement ≈ 1,440 kg ≈ 28.8 bags of 50 kg.",
      "Example M20 (1:1.5:3) per m³: 1.54 ÷ 5.5 = 0.28 m³ cement ≈ 403 kg ≈ 8.1 bags; sand 0.42 m³; 20 mm aggregate 0.84 m³ (before wastage).",
      "Use the approved design mix for actual RMC quantities; nominal-mix figures are site budgeting aids only."
    ]
  },
  {
    id: "concrete-defects",
    match: /\b(honeycomb(ing)?|cold joint|segregation|bleeding|plastic shrinkage|crack(s|ing)?|spalling|efflorescence|repair mortar)\b/i,
    source: "General concrete practice (IS 456 cl. 13–14; ACI 224R, ACI 546R)",
    lines: [
      "Honeycombing: usually poor compaction, congested reinforcement, grout loss at form joints, low workability or excessive drop height. Shallow areas: break out loose material to sound concrete, prime, patch with approved polymer-modified repair mortar; deep/structural: engineer assessment, possibly micro-concrete or grouting.",
      "Plastic shrinkage cracks: rapid surface evaporation before setting — prevent with fogging, wind breaks, evaporation retarder and early curing.",
      "Any structural crack, deep honeycomb at congested zones or cover loss to reinforcement needs the structural engineer's review before repair."
    ]
  }
];

function relevantEngineeringReference(message, limit = 3) {
  const text = String(message || "");
  const hits = REFERENCES.filter((ref) => ref.match.test(text)).slice(0, limit);
  if (!hits.length) return "";
  const lines = ["ENGINEERING REFERENCE (server-side, code-sourced; cite the source when you use a figure, and defer to the project specification and responsible engineer):"];
  hits.forEach((ref) => {
    lines.push(`${ref.source}:`);
    ref.lines.forEach((line) => lines.push(`- ${line}`));
  });
  return lines.join("\n");
}

module.exports = { REFERENCES, relevantEngineeringReference };
