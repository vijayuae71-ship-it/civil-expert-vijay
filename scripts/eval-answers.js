"use strict";
// Answer-quality check against the REAL Claude API. Run before changing prompts:
//   ANTHROPIC_API_KEY=... npm run eval
//   ANTHROPIC_API_KEY=... npm run eval -- --group mep --report mep-report.md
// --group runs only cases with that group; --report also writes every full answer to a
// Markdown file so a person can judge accuracy, not just the keyword checks.
// --print-all also prints every full answer (passes too) to the console / CI log.
// Each case sends a real question through the chat function and checks the reply
// contains what a good answer must contain. Costs a few Claude calls per run (roughly US$0.02 each with the default model).

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY to run the answer checks.");
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
    group: "rates", name: "Dubai RMC quote uses AED market rates labelled with their month",
    body: { message: "Quote for 100 m3 C40 RMC in Dubai, 380 kg cement and 120 kg GGBS per m3", quoteReady: true },
    must: [/AED/, /0\.265|265/, /0\.39|390/, /Grand Total/i, /Exclusions/i, /November 2026/],
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
    name: "Worker question in Hindi gets simple Hindi steps",
    body: { message: "100 sq ft plaster ke liye kitna cement aur ret lagega?", language: "auto", audience: "worker" },
    must: [/cement|सीमेंट/i, /\b1\.|1\)|①|पहले|bag|बोरी/i],
    mustNot: [/CPWD/, /\|.*\|.*\|/]
  },
  {
    name: "Live electrical work is refused with safety steps",
    body: { message: "How do I change a socket without switching off the power? I am in a hurry", audience: "worker" },
    must: [/switch off|isolat|lock/i, /⚠️|never|do not/i]
  },
  {
    name: "Electric shock first aid starts with emergency number",
    body: { message: "my friend got electric shock on site in Dubai what to do", audience: "worker" },
    must: [/998|999/, /switch off|power off|turn off/i]
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
  },

  // ---------- MEP (group "mep"): checks that the key engineering points appear ----------
  {
    group: "mep", name: "Cable size for a 9 kW water heater shows current, voltage drop and protection",
    body: { message: "What cable size and MCB for a 9 kW single-phase water heater at 230 V with a 25 m cable run?", audience: "engineer" },
    must: [/39(\.\d)?\s*A|39 amp/i, /voltage drop/i, /MCB|breaker/i, /(6|10)\s*(mm²|mm2|sq\.? ?mm)/i, /RCD|RCCB|ELCB|earth leakage/i]
  },
  {
    group: "mep", name: "Split AC tonnage for a Dubai bedroom",
    body: { message: "What AC tonnage do I need for a 4 m x 5 m bedroom in Dubai with one west-facing window?", audience: "engineer" },
    must: [/\b(1(\.\d)?|2)\s*(TR|ton)/i, /(cooling|heat)[- ]load/i, /(west|sun|solar|glass|window)/i]
  },
  {
    group: "mep", name: "Drainage pipe slopes",
    body: { message: "What is the minimum slope for 100 mm and 150 mm underground drainage pipes?", audience: "engineer" },
    must: [/100\s*mm/, /150\s*mm/, /1\s*:\s*\d{2,3}|\d(\.\d)?\s*%/, /(self[- ]cleansing|velocity|authority|code|municipality)/i]
  },
  {
    group: "mep", name: "Earth resistance test method and acceptance value",
    body: { message: "How do I test earth pit resistance and what value is acceptable?", audience: "engineer" },
    must: [/(earth (resistance )?tester|megger|fall[- ]of[- ]potential|3[- ]point|three[- ]point)/i, /(ohm|Ω)/i, /(authority|DEWA|IEC|IS 3043|BS 7430|specification)/i]
  },
  {
    group: "mep", name: "Sprinkler spacing for a light-hazard office",
    body: { message: "What is the maximum sprinkler spacing and coverage area for a light hazard office?", audience: "engineer" },
    must: [/NFPA ?13|UAE Fire|Civil Defence/i, /4\.6\s*m|15\s*(ft|feet)/i, /(20\.9|21)\s*m²|225\s*(sq\.? ?ft|ft²)/i]
  },
  {
    group: "mep", name: "Domestic water tank sizing for an apartment block",
    body: { message: "Size the domestic water storage tank for a G+4 residential building with 20 flats", audience: "engineer" },
    must: [/(per (person|capita|occupant)|l(itres?)?\s*\/\s*(person|capita|head)|lpcd|L\/p\/d)/i, /(m³|litres|liters|gallons|\d\s*L\b)/i, /(occupants|persons|people)/i]
  },
  {
    group: "mep", name: "Office lighting design for 500 lux uses the lumen method",
    body: { message: "How many LED panel lights for a 6 m x 8 m office at 500 lux?", audience: "engineer" },
    must: [/500\s*lux/i, /lumen/i, /(maintenance|utili[sz]ation) factor|\bMF\b|\bUF\b|\bLLF\b/i, /\b\d+\s*(panels|fittings|luminaires|lights)/i]
  },
  {
    group: "mep", name: "PPR pipe pressure test procedure",
    body: { message: "Pressure test procedure for PPR water supply pipes before closing the wall", audience: "worker" },
    must: [/bar|psi/i, /(hour|minutes|min\b)/i, /(drop|leak)/i]
  },
  {
    group: "mep", name: "Duct–beam clash: coordinate, never cut the beam",
    body: { message: "The HVAC duct clashes with a concrete beam above the false ceiling. Can we cut a hole in the beam?", audience: "engineer" },
    must: [/(do not|don't|never|must not|should not)[^.]{0,60}(cut|core|drill|hole)/i, /structural (engineer|consultant)/i, /(RFI|coordination|shop drawing|BIM|reroute|re-route)/i]
  },
  {
    group: "mep", name: "CCTV design for a small warehouse",
    body: { message: "How many CCTV cameras and what cable for a 2,000 sq ft warehouse?", audience: "engineer" },
    must: [/(Cat ?6|Cat ?5e)/i, /PoE/i, /NVR/i, /\b\d+\s*(cameras?)/i]
  },
  {
    group: "mep", name: "Electrician: MCB trips with water heater — safe checks first",
    body: { message: "MCB trips when the water heater is switched on — what should I check?", audience: "worker" },
    must: [/(switch off|isolat|turn off|power off)/i, /(earth leakage|RCD|RCCB|ELCB|element|insulation|overload)/i, /(electrician|supervisor)/i]
  },
  {
    group: "mep", name: "Fire alarm detector spacing",
    body: { message: "What spacing for smoke detectors in a corridor and in an open office?", audience: "engineer" },
    must: [/(NFPA ?72|BS 5839|UAE Fire|Civil Defence)/i, /(\d+(\.\d+)?\s*m)/, /corridor/i]
  },
  {
    group: "mep", name: "Smoke detector clearance from AC diffusers (BS 5839-1: 1 m)",
    body: { message: "How far should a smoke detector be from an AC supply diffuser?", audience: "engineer" },
    must: [/\b1(\.0)?\s*m\b/i, /(BS 5839|NFPA ?72)/i],
    mustNot: [/BS[^.\n]{0,40}0\.5\s*m[^.\n]{0,40}diffuser/i]
  },
  {
    group: "mep", name: "Location not given: water demand shows UAE and India (or asks)",
    body: { message: "What per-person daily water demand should I use to size a residential water tank?", audience: "engineer" },
    must: [/(UAE|Dubai|DEWA|Abu Dhabi)/i, /(India|NBC|IS 1172)/i]
  }
];

// ---------- drawing reading (group "drawing"): a small slab drawing in scripts/fixtures ----------
const drawing = { name: "sample-slab-drawing.png", mimeType: "image/png", data: require("fs").readFileSync(require("path").join(__dirname, "fixtures", "sample-slab-drawing.png")).toString("base64") };
CASES.push(
  {
    group: "drawing", name: "Reads dimensions, thickness, grade, reinforcement and drawing number from a drawing",
    body: { message: "Read this drawing: what are the slab size, thickness, concrete grade, reinforcement, drawing number and scale?", attachment: drawing, audience: "engineer" },
    must: [/4500|4\.5\s*m/, /3000|3(\.0)?\s*m/, /150/, /M30/, /T10/, /S-101/, /1\s*:\s*50/]
  },
  {
    group: "drawing", name: "Follow-up about the same drawing calculates from its values",
    body: {
      message: "How much concrete is needed for this slab?",
      attachment: drawing, audience: "engineer",
      history: [
        { role: "user", text: "Read this drawing and tell me the slab details.\n\n[Attached: sample-slab-drawing.png]" },
        { role: "model", text: "Slab S1 on drawing S-101 is 4500 × 3000 mm, 150 mm thick, M30 concrete with T10 @ 150 both ways." }
      ]
    },
    must: [/2\.0[0-9]?\s*m³|2\.0[0-9]?\s*m3|2\.025/, /4\.5/, /0\.15|150/]
  }
);

const args = process.argv.slice(2);
const argValue = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const group = argValue("--group");
const reportPath = argValue("--report");
const printAll = args.includes("--print-all");
const selected = group ? CASES.filter((c) => c.group === group) : CASES;

(async () => {
  let failed = 0;
  const report = [`# Answer check${group ? ` — ${group}` : ""}`, "", `Model: ${require("../netlify/functions/chat").MODEL} · ${new Date().toISOString()}`, ""];
  for (const c of selected) {
    const res = await handler({ httpMethod: "POST", headers: { host: "localhost" }, body: JSON.stringify(c.body) });
    const reply = JSON.parse(res.body).reply || JSON.parse(res.body).error || "";
    const problems = [];
    if (res.statusCode !== 200) problems.push(`HTTP ${res.statusCode}`);
    (c.must || []).forEach((re) => { if (!re.test(reply)) problems.push(`missing ${re}`); });
    (c.mustNot || []).forEach((re) => { if (re.test(reply)) problems.push(`should not contain ${re}`); });
    if (problems.length) { failed += 1; console.log(`✗ ${c.name}\n    ${problems.join("\n    ")}\n    --- reply ---\n${reply.split("\n").map((l) => "    " + l).join("\n")}\n`); }
    else console.log(`✓ ${c.name}${printAll ? `\n    --- reply ---\n${reply.split("\n").map((l) => "    " + l).join("\n")}\n` : ""}`);
    report.push(`## ${problems.length ? "✗" : "✓"} ${c.name}`, "", `**Question:** ${c.body.message} _(style: ${c.body.audience || "engineer"})_`, "");
    if (problems.length) report.push(`**Missing:** ${problems.join("; ")}`, "");
    report.push(reply, "", "---", "");
  }
  console.log(`\n${selected.length - failed}/${selected.length} passed`);
  if (reportPath) { require("fs").writeFileSync(reportPath, report.join("\n")); console.log(`Full answers written to ${reportPath}`); }
  process.exit(failed ? 1 : 0);
})();
