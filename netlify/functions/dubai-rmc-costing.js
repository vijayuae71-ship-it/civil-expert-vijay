"use strict";

// Client-supplied, Dubai-only RMC costing inputs from the uploaded working sheet.
// These are not CPWD rates, public market rates, a mix design, or a supplier quotation.
const DUBAI_RMC_RATES = Object.freeze({
  cement: { label: "Cement / OPC", aedPerMetricTonne: 265, aedPerKg: 0.265 },
  ggbs: { label: "GGBS", aedPerMetricTonne: 390, aedPerKg: 0.390 }
});

function isDubaiRmcCostingRequest(message) {
  const text = String(message || "").toLowerCase();
  const isDubai = /\bdubai\b/.test(text);
  const isConcrete = /\b(rmc|ready[ -]?mix|ready mix|concrete)\b/.test(text);
  const isCosting = /\b(cost|costing|rate|price|estimate|quotation|quote|boq|budget|rate analysis)\b/.test(text);
  return isDubai && isConcrete && isCosting;
}

function relevantDubaiRmcCostingContext(message) {
  if (!isDubaiRmcCostingRequest(message)) return "";
  return [
    "Dubai RMC costing — client/project input (apply only to this Dubai RMC costing request):",
    `- Cement / OPC: AED ${DUBAI_RMC_RATES.cement.aedPerMetricTonne}/metric tonne = AED ${DUBAI_RMC_RATES.cement.aedPerKg.toFixed(3)}/kg.`,
    `- GGBS: AED ${DUBAI_RMC_RATES.ggbs.aedPerMetricTonne}/metric tonne = AED ${DUBAI_RMC_RATES.ggbs.aedPerKg.toFixed(3)}/kg.`,
    "- Use AED, not ₹, for the entire Dubai RMC costing table. Label these two inputs “Client/project input rate (AED)”, not CPWD or market rate.",
    "- Material cost calculation: quantity (kg/m³) × AED/kg. Use only the approved mix design quantities supplied by the user/project; do not infer a mix design, cementitious content, GGBS replacement, strength, durability class, or admixture dosage from this rate input.",
    "- Do not apply these rates outside Dubai or to non-RMC work. Keep aggregate, admixture, water/power, transit mixer, pumping, delivery, labour, fixed overhead, margin, VAT and other inputs separate and clearly marked as supplied or to be confirmed."
  ].join("\n");
}

module.exports = { DUBAI_RMC_RATES, relevantDubaiRmcCostingContext };
