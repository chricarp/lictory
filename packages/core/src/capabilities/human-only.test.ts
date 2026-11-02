import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  CapabilityError,
  defineCapability,
  webOnly,
  type AnyCapability,
} from "@lictory/core/capabilities/core";
import {
  assertHumanOnlyMetadata,
  humanOnlyOperations,
} from "@lictory/core/capabilities/human-only";
import {
  capabilities,
  humanOnlyError,
  listCapabilities,
} from "@lictory/core/capabilities/registry";

void test("every capability agents cannot call says why and where", () => {
  const agentNames = new Set(listCapabilities("mcp").map((c) => c.name));
  const listed = new Map(
    humanOnlyOperations(capabilities).map((o) => [o.name, o]),
  );
  for (const capability of capabilities) {
    if (agentNames.has(capability.name)) {
      assert.ok(!listed.has(capability.name), capability.name);
      continue;
    }
    const operation = listed.get(capability.name);
    assert.ok(operation, `${capability.name} is missing from the policy`);
    assert.ok(operation.where.length > 0);
    assert.ok(operation.explanation.length > 0);
  }
  // Credentials stay with the person; so do account security and membership.
  for (const [name, reason] of [
    ["createAccessToken", "credentials"],
    ["connectDelivery", "credentials"],
    ["changePassword", "account"],
    ["deleteAccount", "account"],
    ["inviteMember", "membership"],
    ["changeApplicationRole", "membership"],
  ] as const)
    assert.equal(listed.get(name)?.reason, reason, name);
  // The policy itself is discoverable everywhere.
  for (const surface of ["web", "mcp", "agent"] as const)
    assert.ok(
      listCapabilities(surface).some(
        (c) => c.name === "listHumanOnlyOperations",
      ),
    );
});

void test("a web-only capability without a reason does not register", () => {
  const silent = defineCapability({
    name: "silentlyWebOnly",
    title: "Silently web only",
    description: "Test capability.",
    kind: "query",
    surfaces: webOnly,
    input: z.object({}),
    run: () => Promise.resolve(null),
  }) as AnyCapability;
  assert.throws(() => assertHumanOnlyMetadata([silent]), /declare humanOnly/);
  assert.doesNotThrow(() =>
    assertHumanOnlyMetadata([
      { ...silent, humanOnly: { reason: "browser", where: "Anywhere" } },
    ]),
  );
});

void test("calling a human-only operation names the reason and the place", () => {
  const error = humanOnlyError("revokeAccessToken");
  assert.ok(error instanceof CapabilityError);
  assert.equal(error.category, "forbidden");
  assert.equal(error.details.kind, "human_only");
  assert.match(error.message, /AI agents \(MCP\)/);
  assert.match(humanOnlyError("syncDirectory")!.message, /getWorkspace/);
  assert.equal(humanOnlyError("getWorkItem"), undefined);
  assert.equal(humanOnlyError("noSuchOperation"), undefined);
});
