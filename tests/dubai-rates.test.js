"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const rates = require("../netlify/functions/dubai-rmc-costing");

test("Dubai rates are labelled as dated market rates, not client inputs", () => {
  const ctx = rates.relevantDubaiRmcCostingContext("Quote for 100 m3 C40 RMC in Dubai", new Date("2026-11-20"));
  assert.match(ctx, /Indicative Dubai market rate \(AED, November 2026\)/);
  assert.match(ctx, /AED 265\/metric tonne/);
  assert.match(ctx, /AED 390\/metric tonne/);
  assert.doesNotMatch(ctx, /Client\/project input rate/);
  assert.doesNotMatch(ctx, /months old/);
});

test("after 6 months the answer is told the rates are old", () => {
  const ctx = rates.relevantDubaiRmcCostingContext("Dubai RMC concrete cost", new Date("2027-06-15"));
  assert.match(ctx, /about 7 months old/);
});

test("only Dubai RMC costing questions get the rates", () => {
  assert.equal(rates.relevantDubaiRmcCostingContext("Abu Dhabi RMC cost"), "");
  assert.equal(rates.relevantDubaiRmcCostingContext("Dubai plaster cost"), "");
});
