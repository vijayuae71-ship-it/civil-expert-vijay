"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { relevantMixDesignContext, targetMeanStrength, requestedGrade } = require("../netlify/functions/mix-design-guidance");

test("reads the grade in common spellings", () => {
  assert.equal(requestedGrade("m100 mix design"), 100);
  assert.equal(requestedGrade("M 40 mix"), 40);
  assert.equal(requestedGrade("M-25 concrete"), 25);
  assert.equal(requestedGrade("C80/95 mix proportion"), 95);
  assert.equal(requestedGrade("mix design for a slab"), null);
});

test("IS 10262:2019 target mean strength", () => {
  assert.equal(targetMeanStrength(100).value.toFixed(1), "109.9");
  assert.equal(targetMeanStrength(40).value.toFixed(2), "48.25");
  assert.equal(targetMeanStrength(20).value.toFixed(1), "26.6");
});

test("M100 guidance includes silica fume, PCE and a per-m³ table requirement", () => {
  const ctx = relevantMixDesignContext("for m100 mix design analysis");
  assert.match(ctx, /silica fume/i);
  assert.match(ctx, /superplasticiser/i);
  assert.match(ctx, /0\.20–0\.24/);
  assert.match(ctx, /EVERY constituent/);
  assert.doesNotMatch(ctx, /Normal-strength/);
});

test("every grade falls in exactly one band", () => {
  for (let g = 10; g <= 150; g += 1) {
    const ctx = relevantMixDesignContext(`M${g} mix design`);
    const bands = (ctx.match(/strength concrete \(/g) || []).length;
    assert.equal(bands, 1, `M${g}`);
  }
});

test("non mix-design questions get no mix guidance", () => {
  assert.equal(relevantMixDesignContext("M25 RMC rate in Dubai"), "");
  assert.equal(relevantMixDesignContext("how to cure an M30 slab"), "");
});
