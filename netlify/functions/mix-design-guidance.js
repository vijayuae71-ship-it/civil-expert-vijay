"use strict";

// Concrete mix-design guidance by strength band. Indicative trial-mix starting points
// only (IS 10262:2019 / ACI 211.4R practice); never an approved mix design.
// Without this context the model tends to give a short generic answer and omits
// constituents that high grades cannot be made without (silica fume, PCE, low w/b).

const BANDS = [
  {
    id: "normal", min: 0, max: 55,
    label: "Normal-strength concrete (up to M55)",
    lines: [
      "Binder: OPC 43/53 (IS 269) 300–450 kg/m³; optional fly ash (IS 3812) 15–35% or GGBS (IS 16714) 25–50% of binder for durability/heat control.",
      "Water–binder ratio 0.40–0.55 (lower for severe exposure; check IS 456 Table 5 limits). Water 160–190 kg/m³ before admixture reduction.",
      "Admixture: plasticiser or PCE superplasticiser (IS 9103) 0.5–1.2% by mass of binder.",
      "Aggregates: 20 mm (and 10 mm) crushed coarse aggregate plus Zone II sand (IS 383); fine aggregate typically 35–42% of total aggregate."
    ]
  },
  {
    id: "high", min: 56, max: 84,
    label: "High-strength concrete (M56–M84)",
    lines: [
      "Binder 450–560 kg/m³: OPC 53 grade + silica fume / micro silica (IS 15388) 5–10% of binder is normally required; fly ash or GGBS 10–25% optional for workability and heat.",
      "Water–binder ratio 0.25–0.33; water 140–160 kg/m³.",
      "Admixture: high-range PCE superplasticiser (IS 9103) 1.0–2.0% by mass of binder (state liquid vs solids basis); retarder for hot weather / long haul.",
      "Aggregates: 12.5–20 mm maximum size, strong crushed granite/basalt (low ACV/AIV, clean, cubical); well-graded sand FM 2.6–3.0, fine aggregate 35–40% of total aggregate."
    ]
  },
  {
    id: "very-high", min: 85, max: 999,
    label: "Very-high-strength concrete (M85–M100 and above)",
    lines: [
      "Total binder 580–700 kg/m³. Typical split: OPC 53 grade (low C3A, consistent fineness) 75–85%; silica fume / micro silica (IS 15388, densified) 8–12% of binder — essential at this grade; optional fly ash or GGBS 5–15%.",
      "Water–binder ratio 0.20–0.24; water 130–150 kg/m³ (count admixture water).",
      "Admixture: high-range PCE superplasticiser (IS 9103) 1.5–3.0% by mass of binder; a viscosity-modifier/retarder may be needed. Dosage is set by trial, not assumed.",
      "Aggregates: 10–12.5 mm maximum size crushed granite/basalt of high parent-rock strength; well-graded sand FM 2.6–3.0 (manufactured sand acceptable if fines are controlled); fine aggregate about 36–42% of total aggregate.",
      "Indicative M100 trial-mix starting point per m³ (SSD aggregates): OPC 53 ≈ 520 kg, silica fume ≈ 60 kg, fly ash/GGBS ≈ 40 kg (total binder ≈ 620 kg), water ≈ 140 kg (w/b ≈ 0.23), PCE ≈ 12 kg, fine aggregate ≈ 680 kg, 10–12.5 mm coarse aggregate ≈ 1,020 kg; fresh density check ≈ 2,450–2,550 kg/m³.",
      "Production/QA notes: longer mixing time and specific charging sequence for silica fume; temperature control (chilled water/ice in UAE heat); immediate and extended moist curing; elevated-temperature/early-age cracking risk; trial batches at the plant and 7/28/56-day testing before approval."
    ]
  }
];

// IS 10262:2019 Tables 1 & 2: target mean strength = max(fck + 1.65·s, fck + X).
function targetMeanStrength(fck) {
  const [s, x] = fck <= 15 ? [3.5, 5.0] : fck <= 25 ? [4.0, 5.5] : fck <= 60 ? [5.0, 6.5] : [6.0, 8.0];
  return { s, x, value: Math.max(fck + 1.65 * s, fck + x) };
}

function requestedGrade(text) {
  // "M100", "M 100", "M-100", "C80/95" (cube strength is the second figure).
  const cube = text.match(/\bc\s?(\d{2,3})\s?\/\s?(\d{2,3})\b/i);
  if (cube) return Number(cube[2]);
  const m = text.match(/\bm\s?-?\s?(\d{2,3})\b/i);
  return m ? Number(m[1]) : null;
}

function isMixDesignRequest(text) {
  return /\bmix\s*-?\s*(design|proportion(ing)?|ratio|calculation|analysis)\b|\btrial\s+mix\b|\bconcrete\s+(ingredients|constituents)\b/i.test(text)
    || (requestedGrade(text) !== null && /\b(ingredients|constituents|proportion|kg\s*\/\s*m3|kg\s*per\s*(m3|cubic))\b/i.test(text));
}

function relevantMixDesignContext(message) {
  const text = String(message || "");
  if (!isMixDesignRequest(text)) return "";
  const grade = requestedGrade(text);
  const bands = grade === null ? BANDS : BANDS.filter((band) => grade >= band.min && grade <= band.max);
  const selected = bands.length ? bands : [BANDS[BANDS.length - 1]];
  const lines = [
    "CONCRETE MIX-DESIGN GUIDANCE (server-side reference; indicative trial-mix starting points only, not an approved mix design):"
  ];
  if (grade !== null) {
    const t = targetMeanStrength(grade);
    lines.push(`- Requested grade: M${grade}. Target mean strength per IS 10262:2019 = max(fck + 1.65 × ${t.s}, fck + ${t.x}) = ${t.value.toFixed(1)} MPa (assumed standard deviation ${t.s} MPa until site data exists).`);
  }
  selected.forEach((band) => {
    lines.push(`${band.label}:`);
    band.lines.forEach((line) => lines.push(`- ${line}`));
  });
  lines.push(
    "Answer requirements for this mix-design request:",
    "- Include a Markdown table listing EVERY constituent for 1 m³: cement, each supplementary cementitious material (silica fume / micro silica, fly ash, GGBS as applicable), water, each chemical admixture, fine aggregate, and each coarse aggregate size — with kg/m³, % of binder where relevant, and the governing standard.",
    "- Show the step-by-step working: target mean strength, w/b selection, water content, binder content and split, admixture dosage, volume of aggregates by absolute-volume method, and a yield / fresh-density check.",
    "- For M60 and above never omit silica fume (micro silica) and high-range superplasticiser; state why each is required.",
    "- State that quantities are for trial batching only and must be confirmed by plant trials, material test certificates, specific gravities, moisture corrections and the responsible engineer.",
    "- This request may use up to 450 words plus the table; still finish with a complete **Next Step**."
  );
  return lines.join("\n");
}

module.exports = { relevantMixDesignContext, targetMeanStrength, requestedGrade };
