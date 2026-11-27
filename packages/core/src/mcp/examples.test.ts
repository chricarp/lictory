import assert from "node:assert/strict";
import { test } from "node:test";

import { listCapabilities } from "@lictory/core/capabilities/registry";
import { exampleArguments } from "@lictory/core/mcp/examples";

// The reference's examples are copied into real calls: each must pass the
// tool's own input schema, including rules across fields.
void test("every MCP tool's documented example passes the tool's input schema", () => {
  for (const capability of listCapabilities("mcp")) {
    const example = exampleArguments(capability);
    const parsed = capability.input.safeParse(example);
    assert.ok(
      parsed.success,
      `${capability.name}: ${JSON.stringify(example)} is refused: ${parsed.error?.message}`,
    );
  }
});

void test("a tool that takes one of two fields gets an example with exactly one", () => {
  const getWorkItem = listCapabilities("mcp").find(
    (c) => c.name === "getWorkItem",
  )!;
  assert.deepEqual(exampleArguments(getWorkItem), {
    organizationId: "acme",
    workItemId: "PAY-142",
  });
});
