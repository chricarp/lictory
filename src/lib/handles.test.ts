import assert from "node:assert/strict";
import { test } from "node:test";

import {
  handleCandidates,
  handleProblem,
  matchesPerson,
  normalizeHandle,
} from "./handles";

void test("normalizing strips @ and lowercases", () => {
  assert.equal(normalizeHandle("  @@Alex_M "), "alex_m");
});

void test("validation rejects malformed and reserved handles", () => {
  assert.equal(handleProblem("alex_morgan"), null);
  for (const bad of [
    "al",
    "1alex",
    "alex-morgan",
    "alex__m",
    "alex_",
    "admin",
    "a".repeat(31),
  ])
    assert.notEqual(handleProblem(bad), null, bad);
});

void test("candidates are valid, unique and derived from name and email", () => {
  const candidates = handleCandidates("Zoë O'Brien", "zob@example.test");
  assert.equal(candidates[0], "zoe_o_brien");
  assert.ok(candidates.includes("zob"));
  assert.equal(new Set(candidates).size, candidates.length);
  for (const c of candidates) assert.equal(handleProblem(c), null, c);
});

void test("candidates exist even for names without usable letters", () => {
  const candidates = handleCandidates("李雷", "12@example.test");
  assert.ok(candidates.length > 3);
  for (const c of candidates) assert.equal(handleProblem(c), null, c);
});

void test("@query matches handles only; plain text also matches names", () => {
  const person = { name: "Riley Chen", email: "r@x.test", handle: "rc" };
  assert.equal(matchesPerson(person, "@rc"), true);
  assert.equal(matchesPerson(person, "@riley"), false);
  assert.equal(matchesPerson(person, "riley"), true);
  assert.equal(matchesPerson(person, "rc"), true);
});
