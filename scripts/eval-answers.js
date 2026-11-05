"use strict";
// Answer-quality check against the REAL Gemini API. Run before changing prompts:
//   GEMINI_API_KEY=... npm run eval
// Each case sends a real question through the chat function and checks the reply
// contains what a good answer must contain. Costs a few Gemini calls per run.

if (!process.env.GEMINI_API_KEY) {
  console.error("Set GEMINI_API_KEY to run the answer checks.");
  process.exit(1);
}
process.env.CHAT_LIMIT_PER_IP_HOUR = "1000";
const { handler } = require("../netlify/functions/chat");

const CASES = [
  {
    name: "M100 mix design lists every high-strength constituent",
    body: { message: "for m100 mix design analysis" },
    must: [/silica fume|micro ?silica/i, /superplasticiser|superplasticizer|PCE/i, /w\/b|water[- ]binder/i, /\|.*kg/i, /trial/i]
  },
  {
    name: "Dubai RMC quote uses AED client rates",
    body: { message: "Quote for 100 m3 C40 RMC in Dubai, 380 kg cement and 120 kg GGBS per m3", quoteReady: true },
    must: [/AED/, /0\.265|265/, /0\.39|390/, /Grand Total/i, /Exclusions/i],
    mustNot: [/CPWD DSR Base Rate/]
  },
  {
    name: "Painting estimate is answered, not rejected",
    body: { message: "600 sft carpet house luxury paint cost" },
    must: [/\|/, /primer|putty/i, /Preliminary/i],
    mustNot: [/I can help only with construction-related topics/]
  },
  {
    name: "Formwork striking cites IS 456",
    body: { message: "When can I remove props under a 5 m span slab?" },
    must: [/14 days/, /IS 456/]
  },
  {
    name: "Transit mixer planning shows the calculation",
    body: { message: "How many transit mixers for a 300 m3 raft pour in 8 hours with a 40 min round trip and 9 m3 trucks?" },
    must: [/37\.5/, /\b(3|4)\b.*(transit|TM|truck)/i]
  },
  {
    name: "Off-topic question is refused",
    body: { message: "Who will win the next football world cup?" },
    must: [/construction-related topics/i]
  },
  {
    name: "Follow-up keeps context",
    body: {
      message: "now make it M30 instead",
      history: [
        { role: "user", text: "Concrete quantity and cement for a 10 m x 5 m x 0.15 m slab in M25" },
        { role: "model", text: "**Recommendation**\nOrder 7.9 m³ of M25 (7.5 m³ + 5% wastage)." }
      ]
    },
    must: [/M30/, /7\.(5|9)/]
  }
];

(async () => {
  let failed = 0;
  for (const c of CASES) {
    const res = await handler({ httpMethod: "POST", headers: { host: "localhost" }, body: JSON.stringify(c.body) });
    const reply = JSON.parse(res.body).reply || JSON.parse(res.body).error || "";
    const problems = [];
    if (res.statusCode !== 200) problems.push(`HTTP ${res.statusCode}`);
    (c.must || []).forEach((re) => { if (!re.test(reply)) problems.push(`missing ${re}`); });
    (c.mustNot || []).forEach((re) => { if (re.test(reply)) problems.push(`should not contain ${re}`); });
    if (problems.length) { failed += 1; console.log(`✗ ${c.name}\n    ${problems.join("\n    ")}\n    --- reply ---\n${reply.split("\n").map((l) => "    " + l).join("\n")}\n`); }
    else console.log(`✓ ${c.name}`);
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
  process.exit(failed ? 1 : 0);
})();
