import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DeliveryConnectionSummary,
  DeliveryTargetSummary,
} from "@lictory/core/contracts/protocol";
import {
  deliveryToolOf,
  projectDeliveryTool,
} from "@lictory/platform/components/delivery/provider-name";

const connection = (
  id: string,
  provider = "jira_cloud",
): DeliveryConnectionSummary => ({
  id,
  provider: provider as DeliveryConnectionSummary["provider"],
  name: `Site ${id}`,
  baseUrl: "https://example.test",
  accountLabel: "bot",
  status: "active",
  lastError: null,
});
const target = (projectId: string, connectionId: string) =>
  ({
    id: `t-${projectId}`,
    connectionId,
    projectId,
    externalProjectId: "1",
    externalProjectKey: "PAY",
    typeMapping: {},
  }) satisfies DeliveryTargetSummary;
const directory = (
  connections: DeliveryConnectionSummary[],
  targets: DeliveryTargetSummary[] = [],
) => ({ delivery: { connections, targets } });

void test("names the provider of the project's target connection", () => {
  const tool = projectDeliveryTool(
    directory([connection("c1")], [target("p1", "c1")]),
    "p1",
  );
  assert.deepEqual(tool, { name: "Jira", Name: "Jira", product: "Jira" });
});

void test("stays generic when nothing is connected", () => {
  const tool = projectDeliveryTool(directory([]), "p1");
  assert.equal(tool.product, null);
  assert.equal(tool.name, "your delivery tool");
  assert.equal(tool.Name, "Your delivery tool");
});

void test("before a target is chosen, a single-provider organization names it", () => {
  const tool = projectDeliveryTool(
    directory([connection("c1"), connection("c2")]),
    "p1",
  );
  assert.equal(tool.product, "Jira");
});

void test("before a target is chosen, mixed providers stay generic", () => {
  const tool = projectDeliveryTool(
    directory([connection("c1"), connection("c2", "linear")]),
    "p1",
  );
  assert.equal(tool.product, null);
});

void test("an unknown provider kind never borrows another vendor's name", () => {
  assert.equal(deliveryToolOf(connection("c1", "linear")).product, null);
  assert.equal(deliveryToolOf(undefined).name, "your delivery tool");
});
