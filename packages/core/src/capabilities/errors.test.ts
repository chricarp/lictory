import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { toCapabilityError } from "@lictory/core/capabilities/errors";

const failure = (schema: z.ZodType, input: unknown) => {
  const parsed = schema.safeParse(input);
  assert.equal(parsed.success, false);
  return toCapabilityError(parsed.error).toJSON();
};

void test("validation errors name the field in words, not the schema library's defaults", () => {
  const schema = z.strictObject({
    claimId: z.string().min(1),
    note: z.string().max(5).optional(),
    limit: z.number().int().max(200).optional(),
    key: z
      .string()
      .regex(/^[A-Z]+-\d+$/, "Use a key such as PAY-142.")
      .optional(),
  });
  assert.equal(
    failure(schema, { claimId: "" }).message,
    "claimId cannot be empty.",
  );
  assert.equal(failure(schema, {}).message, "claimId is required.");
  assert.equal(
    failure(schema, { claimId: "c", note: "too long" }).message,
    "note is at most 5 characters long.",
  );
  assert.equal(
    failure(schema, { claimId: "c", limit: 500 }).message,
    "limit is at most 200.",
  );
  // A schema's own message is kept, with the field it is about.
  assert.equal(
    failure(schema, { claimId: "c", key: "pay" }).message,
    "key: Use a key such as PAY-142.",
  );
  // Several problems are all named.
  const both = failure(schema, { note: "too long" });
  assert.equal(both.category, "validation");
  assert.match(both.message, /claimId is required\. note is at most 5/);
});
