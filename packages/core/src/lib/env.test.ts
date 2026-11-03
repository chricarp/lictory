import assert from "node:assert/strict";
import { test } from "node:test";
import { aiModelId, DEFAULT_AI_MODEL } from "@lictory/core/ai/analyzer";
import { env, envBoolean, envInteger } from "@lictory/core/lib/env";

// Compose forwards unset variables as empty strings (`${VAR:-}`).
const blanks = [{}, { VALUE: "" }, { VALUE: "   " }, { VALUE: "\n\t" }];

void test("empty, whitespace-only and unset variables are unset", () => {
  for (const source of blanks) {
    assert.equal(env("VALUE", source), undefined);
    assert.equal(envInteger("VALUE", source), undefined);
    assert.equal(envBoolean("VALUE", source), undefined);
  }
  assert.equal(env("VALUE", { VALUE: "  set  " }), "set");
  assert.equal(envInteger("VALUE", { VALUE: " 587 " }), 587);
});

void test("a set value of the wrong kind is rejected", () => {
  for (const VALUE of ["abc", "25.5", "-1", "1e3"])
    assert.throws(() => envInteger("VALUE", { VALUE }), /VALUE/);
  for (const VALUE of ["maybe", "on", "constructor"])
    assert.throws(() => envBoolean("VALUE", { VALUE }), /VALUE/);
});

void test("booleans accept true/false, yes/no and 1/0", () => {
  for (const VALUE of ["true", " TRUE ", "yes", "1"])
    assert.equal(envBoolean("VALUE", { VALUE }), true);
  for (const VALUE of ["false", "No", "0"])
    assert.equal(envBoolean("VALUE", { VALUE }), false);
});

void test("the AI model falls back to the default when unset or blank", () => {
  for (const LICTORY_AI_MODEL of [undefined, "", "   "])
    assert.equal(aiModelId({ LICTORY_AI_MODEL }), DEFAULT_AI_MODEL);
  assert.equal(aiModelId({ LICTORY_AI_MODEL: " gpt-test " }), "gpt-test");
});
