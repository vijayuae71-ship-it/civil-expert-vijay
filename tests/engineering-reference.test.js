"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { relevantEngineeringReference, REFERENCES } = require("../netlify/functions/site-engineering-reference");

test("matches the right reference for typical site questions", () => {
  const cases = [
    ["When can I remove slab props for a 5 m span?", /clause 11\.3\.1/],
    ["How many cubes for a 120 m3 pour?", /15\.2\.2/],
    ["Minimum cover for severe exposure", /Table 16/],
    ["How many transit mixers for a 300 m3 raft?", /ceiling/],
    ["How long to cure GGBS concrete?", /13\.5\.1/],
    ["bags of cement for 1 m3 M20 nominal mix", /Table 9/],
    ["Diagnose honeycombing in a column", /Honeycombing/]
  ];
  for (const [q, re] of cases) assert.match(relevantEngineeringReference(q), re, q);
});

test("unrelated questions get nothing", () => {
  assert.equal(relevantEngineeringReference("painting cost for 2BHK"), "");
});

test("every reference has a source and lines", () => {
  for (const ref of REFERENCES) {
    assert.ok(ref.id && ref.source && ref.lines.length >= 2, ref.id);
  }
});
