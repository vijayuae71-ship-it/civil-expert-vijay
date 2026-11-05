"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { findVerifiedCivilMatches, buildCivilCatalogueContext, catalogue } = require("../netlify/functions/cpwd-civil-catalogue");

const sample = [{ itemNumber: "9.9.9", description: "Sample item", unit: "cum", rate: 100, volume: "Volume 1", page: 1, keywords: ["pcc", "1:2:4"] }];

test("matches by item number or by all keywords", () => {
  assert.equal(findVerifiedCivilMatches("rate for item 9.9.9", sample).length, 1);
  assert.equal(findVerifiedCivilMatches("PCC 1:2:4 for flooring", sample).length, 1);
  assert.equal(findVerifiedCivilMatches("PCC 1:3:6", sample).length, 0);
});

test("with no verified items the model is told not to claim verification", () => {
  assert.equal(catalogue.verifiedItems.length, 0);
  assert.match(buildCivilCatalogueContext("BOQ for PCC"), /To be verified against applicable CPWD DSR/);
});
