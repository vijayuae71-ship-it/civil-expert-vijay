"use strict";

// Indicative Dubai market rates for RMC costing (cement and GGBS), supplied by the site owner.
// Update the figures and AS_OF together whenever the market moves.
// They are market rates, not CPWD rates, a mix design or a supplier quotation.
const AS_OF = "2026-11";          // year-month the rates were taken
const AS_OF_LABEL = "November 2026";
const DUBAI_RMC_RATES = Object.freeze({
  cement: { label: "Cement / OPC", aedPerMetricTonne: 265, aedPerKg: 0.265 },
  ggbs: { label: "GGBS", aedPerMetricTonne: 390, aedPerKg: 0.390 }
});
const RATE_LABEL = `Indicative Dubai market rate (AED, ${AS_OF_LABEL})`;

function isDubaiRmcCostingRequest(message) {
  const text = String(message || "").toLowerCase();
  const isDubai = /\bdubai\b/.test(text);
  const isConcrete = /\b(rmc|ready[ -]?mix|ready mix|concrete)\b/.test(text);
  const isCosting = /\b(cost|costing|rate|price|estimate|quotation|quote|boq|budget|rate analysis)\b/.test(text);
  return isDubai && isConcrete && isCosting;
}

// Whole months between the rate date and now (for an "these rates are old" warning).
function monthsOld(now = new Date()) {
  const [y, m] = AS_OF.split("-").map(Number);
  return (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
}

function relevantDubaiRmcCostingContext(message, now = new Date()) {
  if (!isDubaiRmcCostingRequest(message)) return "";
  const age = monthsOld(now);
  return [
    `Dubai RMC costing — indicative market rates as of ${AS_OF_LABEL} (apply only to this Dubai RMC costing request):`,
    `- Cement / OPC: AED ${DUBAI_RMC_RATES.cement.aedPerMetricTonne}/metric tonne = AED ${DUBAI_RMC_RATES.cement.aedPerKg.toFixed(3)}/kg.`,
    `- GGBS: AED ${DUBAI_RMC_RATES.ggbs.aedPerMetricTonne}/metric tonne = AED ${DUBAI_RMC_RATES.ggbs.aedPerKg.toFixed(3)}/kg.`,
    `- Use AED, not ₹, for the entire Dubai RMC costing table. Label these two inputs “${RATE_LABEL}”, never as CPWD rates, and say that market prices change and should be confirmed with current supplier quotations.`,
    ...(age >= 6 ? [`- These rates are about ${age} months old: say so clearly and recommend getting current supplier prices before relying on the figures.`] : []),
    "- If the user gives their own cement or GGBS price, use the user's price instead and label it “Client/project rate (AED)”.",
    "- Material cost calculation: quantity (kg/m³) × AED/kg. Use only the approved mix design quantities supplied by the user/project; do not infer a mix design, cementitious content, GGBS replacement, strength, durability class, or admixture dosage from these rates.",
    "- Do not apply these rates outside Dubai or to non-RMC work. Keep aggregate, admixture, water/power, transit mixer, pumping, delivery, labour, fixed overhead, margin, VAT and other inputs separate and clearly marked as supplied or to be confirmed."
  ].join("\n");
}

module.exports = { DUBAI_RMC_RATES, AS_OF, RATE_LABEL, monthsOld, relevantDubaiRmcCostingContext };
