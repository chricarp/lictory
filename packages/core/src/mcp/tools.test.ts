import assert from "node:assert/strict";
import { test } from "node:test";
import { listCapabilities } from "@lictory/core/capabilities/registry";
import { inputSchemaOf, toolOf } from "@lictory/core/mcp/server";

type Schema = {
  description?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
};

// Fields a model (and the generated reference) would have to guess. The
// fields of nested objects count too; a union's description covers the
// shapes of its variants.
function undescribed(schema: Schema, path = ""): string[] {
  const missing: string[] = [];
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const variants = field.anyOf ?? field.oneOf ?? [];
    const own =
      field.description ?? variants.find((v) => v.description)?.description;
    if (!own) missing.push(`${path}${name}`);
    for (const nested of [field, field.items])
      if (nested) missing.push(...undescribed(nested, `${path}${name}.`));
  }
  return missing;
}

void test("every field of every MCP tool says what it is", () => {
  const missing = listCapabilities("mcp").flatMap((capability) =>
    undescribed(inputSchemaOf(capability) as Schema).map(
      (field) => `${capability.name}: ${field}`,
    ),
  );
  assert.deepEqual(
    missing,
    [],
    "Describe these fields in the capability's schema (.describe), or in mcp/field-descriptions.ts when the name means the same everywhere.",
  );
});

void test("shared identifiers are described for the tool's own objects", () => {
  const describe = (tool: string, field: string) =>
    (
      inputSchemaOf(
        listCapabilities("mcp").find((c) => c.name === tool)!,
      ) as Schema
    ).properties?.[field]?.description ?? "";
  assert.match(describe("getWorkItem", "workItemId"), /key such as PAY-142/);
  assert.match(describe("mergePagePullRequest", "pullRequestId"), /^Page /);
  assert.match(describe("mergeCodePullRequest", "pullRequestId"), /code/);
  assert.match(describe("mergePullRequest", "pullRequestId"), /Specification/);
  // A capability's own description wins over the shared one.
  assert.match(
    describe("getWorkspace", "projectId"),
    /limited to this project/,
  );
});

void test("idempotentHint holds only for calls that are safe to repeat as sent", () => {
  const tool = (name: string) =>
    toolOf(listCapabilities("mcp").find((c) => c.name === name)!);
  // Queries never change anything.
  assert.equal(tool("getWorkItem").annotations.idempotentHint, true);
  // Retry safety that rests on an optional mutationId is not a promise
  // about the same arguments: a client that omits it creates a duplicate.
  for (const name of ["claimItem", "createWorkItem"]) {
    assert.ok("mutationId" in (tool(name).inputSchema.properties as object));
    assert.equal(tool(name).annotations.idempotentHint, false, name);
  }
  // A command that is safe to repeat as it is keeps the hint.
  assert.equal(tool("reactToChannelMessage").annotations.idempotentHint, true);
});
