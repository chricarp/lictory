import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canWrite,
  connectionProblem,
  presentation,
  viewStatus,
  type ConnectionName,
} from "@lictory/platform/data/connection";
import { reconcileRows, type RowCache } from "@lictory/platform/data/rows";

void test("the view is hydrating until the first authoritative answer", () => {
  for (const name of ["initializing", "connecting", "connected"] as const)
    assert.equal(viewStatus(name, false), "hydrating");
  assert.equal(viewStatus("disconnected", false), "offline");
  for (const name of ["error", "needs-auth", "closed"] as const)
    assert.equal(viewStatus(name, false), "failed");
  // Once complete, synchronized data stays readable whatever the connection.
  for (const name of ["disconnected", "error", "needs-auth"] as const)
    assert.equal(viewStatus(name, true), "synced");
});

void test("the sync indicator follows the connection and unsent work", () => {
  const base = { everConnected: true, busy: false, rejected: 0 };
  const of = (connection: ConnectionName, extra: Partial<typeof base> = {}) =>
    presentation({ connection, ...base, ...extra });
  assert.equal(of("connected"), "idle");
  assert.equal(of("connected", { busy: true }), "busy");
  assert.equal(of("connected", { rejected: 1 }), "attention");
  assert.equal(of("connecting"), "recovering");
  assert.equal(of("connecting", { everConnected: false }), "idle");
  // A reload while the server is unreachable: still retrying.
  assert.equal(
    presentation({
      ...base,
      connection: "connecting",
      everConnected: false,
      reason: "Failed to connect",
    }),
    "recovering",
  );
  assert.equal(
    of("initializing", { everConnected: false, busy: true }),
    "busy",
  );
  assert.equal(of("disconnected", { rejected: 2 }), "offline");
  assert.equal(of("error"), "attention");
  assert.equal(of("needs-auth"), "access");
  assert.equal(of("closed"), "access");
});

void test("writes are only accepted while Zero can reach the server", () => {
  assert.ok(canWrite("connected"));
  assert.ok(canWrite("connecting"));
  assert.ok(!canWrite("disconnected"));
  assert.ok(!canWrite("needs-auth"));
  assert.match(connectionProblem("needs-auth") ?? "", /Sign in again/);
  assert.equal(connectionProblem("connected"), undefined);
  assert.equal(connectionProblem("connecting"), undefined);
  assert.match(
    connectionProblem("connecting", "timeout") ?? "",
    /interrupted: timeout/,
  );
  assert.match(connectionProblem("error", "push failed") ?? "", /push failed/);
});

void test("unchanged rows keep their identity across updates", () => {
  const cache: RowCache = new Map();
  const project = { type: "project", id: "p", name: "Payments" };
  const rows = [
    { key: "project:p", type: "project", data: project, updatedAt: 1 },
    { key: "directory:o", type: "directory", data: {}, updatedAt: 1 },
  ];
  const first = reconcileRows(rows, cache, undefined);
  assert.deepEqual(Object.keys(first), ["project:p"]);
  // Same content in a new object: same entity, same record.
  const again = reconcileRows(
    [{ ...rows[0]!, data: { ...project } }, rows[1]!],
    cache,
    first,
  );
  assert.equal(again, first);
  const renamed = reconcileRows(
    [{ ...rows[0]!, data: { ...project, name: "Pay" }, updatedAt: 2 }],
    cache,
    again,
  );
  assert.notEqual(renamed, first);
  assert.equal(
    (renamed["project:p"] as unknown as { name: string }).name,
    "Pay",
  );
  const removed = reconcileRows([], cache, renamed);
  assert.deepEqual(removed, {});
});
