import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { z } from "zod";
import * as s from "@lictory/core/db/schema";
import { recordAuditEvent } from "@lictory/core/domain/audit";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { runnerEntity } from "@lictory/core/factory/entities";
import {
  LEASE_SECONDS,
  REGISTRATION_TOKEN_PREFIX,
  RUNNER_CREDENTIAL_PREFIX,
  type heartbeatRequest,
  type registerRequest,
} from "@lictory/core/factory/protocol";
import { factoryWrite, projectRunner } from "@lictory/core/factory/store";

// Runners: machines that execute agent sessions
// (docs/internals/factory.md#runners). A registration token is created by a
// person in the browser and exchanged once, within an hour, for a runner
// credential. Only SHA-256 hashes of both are stored.

export type RunnerRow = typeof s.runner.$inferSelect;

const REGISTRATION_MS = 60 * 60_000;
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
const secretFor = (prefix: string) =>
  prefix + randomBytes(32).toString("base64url");

const runnerTarget = (row: RunnerRow) => ({
  type: "runner",
  id: row.id,
  label: row.name,
});

// An organization administrator creates a token for an organization runner;
// any member for a personal runner that only runs their own agents.
export async function createRunnerRegistration(
  db: Database,
  userId: string,
  organizationId: string,
  input: { personal: boolean },
  now = new Date(),
) {
  return factoryWrite(db, organizationId, async (tx) => {
    const membership = await authorize(tx, userId, organizationId);
    if (!input.personal && !isAdmin(membership))
      throw new DomainError(
        "forbidden",
        "Only an organization administrator can add an organization runner. Add a personal runner to run your own agents.",
      );
    const token = secretFor(REGISTRATION_TOKEN_PREFIX);
    const [row] = await tx
      .insert(s.runnerRegistration)
      .values({
        id: crypto.randomUUID(),
        organizationId,
        ownerId: input.personal ? userId : null,
        tokenHash: hash(token),
        prefix: token.slice(0, REGISTRATION_TOKEN_PREFIX.length + 6),
        createdById: userId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + REGISTRATION_MS),
      })
      .returning();
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "runner.registration_created",
      target: { type: "runner_registration", id: row!.id, label: row!.prefix },
      detail: {
        personal: input.personal,
        expiresAt: row!.expiresAt.toISOString(),
      },
    });
    return {
      id: row!.id,
      token,
      personal: input.personal,
      expiresAt: row!.expiresAt.toISOString(),
    };
  });
}

const refused = () =>
  new DomainError(
    "forbidden",
    "This registration token is invalid, expired or already used. Create a new one in Factory → Runners.",
    undefined,
    "revoked",
  );

// Exchanges a registration token for a runner credential, once.
export async function registerRunner(
  db: Database,
  request: z.infer<typeof registerRequest>,
  now = new Date(),
) {
  const { token } = request;
  if (!token.startsWith(REGISTRATION_TOKEN_PREFIX) || token.length > 200)
    throw refused();
  const digest = hash(token);
  const [registration] = await db
    .select()
    .from(s.runnerRegistration)
    .where(eq(s.runnerRegistration.tokenHash, digest));
  if (
    !registration ||
    !timingSafeEqual(Buffer.from(registration.tokenHash), Buffer.from(digest))
  )
    throw refused();
  return factoryWrite(db, registration.organizationId, async (tx) => {
    // Single use under concurrency: only one exchange claims the token.
    const [claimed] = await tx
      .update(s.runnerRegistration)
      .set({ usedAt: now })
      .where(
        and(
          eq(s.runnerRegistration.id, registration.id),
          isNull(s.runnerRegistration.usedAt),
          gt(s.runnerRegistration.expiresAt, now),
        ),
      )
      .returning();
    if (!claimed) throw refused();
    // The person who created the token must still be a member (and an
    // administrator, for an organization runner).
    const membership = await authorize(
      tx,
      claimed.createdById,
      claimed.organizationId,
    ).catch(() => null);
    if (!membership || (!claimed.ownerId && !isAdmin(membership)))
      throw refused();
    const credential = secretFor(RUNNER_CREDENTIAL_PREFIX);
    const [row] = await tx
      .insert(s.runner)
      .values({
        id: crypto.randomUUID(),
        organizationId: claimed.organizationId,
        ownerId: claimed.ownerId,
        name: request.name,
        credentialHash: hash(credential),
        credentialPrefix: credential.slice(
          0,
          RUNNER_CREDENTIAL_PREFIX.length + 6,
        ),
        os: request.os,
        arch: request.arch,
        version: request.version,
        hostname: request.hostname ?? "",
        harnesses: request.harnesses,
        labels: request.labels ?? [],
        maxSessions: request.maxSessions,
        isolation: request.isolation,
        lastSeenAt: now,
        createdById: claimed.createdById,
        registeredAt: now,
      })
      .returning();
    await tx
      .update(s.runnerRegistration)
      .set({ runnerId: row!.id })
      .where(eq(s.runnerRegistration.id, claimed.id));
    await projectRunner(tx, row!);
    await recordAuditEvent(tx, {
      organizationId: claimed.organizationId,
      actor: { id: claimed.createdById },
      action: "runner.registered",
      target: runnerTarget(row!),
      detail: {
        personal: Boolean(row!.ownerId),
        os: row!.os,
        arch: row!.arch,
        isolation: row!.isolation,
        prefix: row!.credentialPrefix,
      },
    });
    return {
      runnerId: row!.id,
      organizationId: row!.organizationId,
      name: row!.name,
      personal: Boolean(row!.ownerId),
      credential,
    };
  });
}

// The runner a credential belongs to, while it is not revoked. A personal
// runner stops working when its owner leaves the organization.
export async function authenticateRunner(db: Database, secret: string) {
  if (!secret.startsWith(RUNNER_CREDENTIAL_PREFIX) || secret.length > 200)
    return null;
  const digest = hash(secret);
  const [row] = await db
    .select()
    .from(s.runner)
    .where(eq(s.runner.credentialHash, digest));
  if (
    !row ||
    row.revokedAt ||
    !timingSafeEqual(Buffer.from(row.credentialHash), Buffer.from(digest))
  )
    return null;
  if (row.ownerId) {
    const membership = await authorize(
      db,
      row.ownerId,
      row.organizationId,
    ).catch(() => null);
    if (!membership) return null;
  }
  return row;
}

// The projection records heartbeats at most this often; readers treat a
// runner as online for a while longer (entities.ts, `runnerOnline`).
const PROJECT_HEARTBEAT_MS = 45_000;
const activeStatuses = ["assigned", "running", "waiting"] as const;

export async function heartbeat(
  db: Database,
  runner: RunnerRow,
  report: z.infer<typeof heartbeatRequest>,
  now = new Date(),
) {
  return factoryWrite(db, runner.organizationId, async (tx) => {
    const changed =
      runner.os !== report.os ||
      runner.arch !== report.arch ||
      runner.version !== report.version ||
      runner.hostname !== (report.hostname ?? runner.hostname) ||
      runner.maxSessions !== report.maxSessions ||
      runner.isolation !== report.isolation ||
      JSON.stringify(runner.harnesses) !== JSON.stringify(report.harnesses) ||
      (report.labels !== undefined &&
        JSON.stringify(runner.labels) !== JSON.stringify(report.labels));
    const stale =
      !runner.lastSeenAt ||
      now.getTime() - runner.lastSeenAt.getTime() > PROJECT_HEARTBEAT_MS;
    if (changed || stale) {
      const [row] = await tx
        .update(s.runner)
        .set({
          os: report.os,
          arch: report.arch,
          version: report.version,
          hostname: report.hostname ?? runner.hostname,
          harnesses: report.harnesses,
          labels: report.labels ?? runner.labels,
          maxSessions: report.maxSessions,
          isolation: report.isolation,
          lastSeenAt: now,
        })
        .where(and(eq(s.runner.id, runner.id), isNull(s.runner.revokedAt)))
        .returning();
      if (row) await projectRunner(tx, row);
    }
    const leases = await renewLeases(tx, runner, report.sessions, now);
    return { serverTime: now.toISOString(), leases };
  });
}

// Renews the leases a runner still holds and tells it which it lost.
async function renewLeases(
  tx: Tx,
  runner: RunnerRow,
  sessions: { sessionId: string; leaseToken: string }[],
  now: Date,
) {
  if (!sessions.length) return [];
  const expires = new Date(now.getTime() + LEASE_SECONDS * 1000);
  const rows = await tx
    .select({
      id: s.agentSession.id,
      status: s.agentSession.status,
      leaseToken: s.agentSession.leaseToken,
      runnerId: s.agentSession.runnerId,
    })
    .from(s.agentSession)
    .where(
      and(
        eq(s.agentSession.organizationId, runner.organizationId),
        inArray(
          s.agentSession.id,
          sessions.map((x) => x.sessionId),
        ),
      ),
    );
  const held = sessions.filter((x) => {
    const row = rows.find((r) => r.id === x.sessionId);
    return (
      row?.runnerId === runner.id &&
      row.leaseToken === x.leaseToken &&
      (activeStatuses as readonly string[]).includes(row.status)
    );
  });
  if (held.length)
    await tx
      .update(s.agentSession)
      .set({ leaseExpiresAt: expires })
      .where(
        and(
          inArray(
            s.agentSession.id,
            held.map((x) => x.sessionId),
          ),
          eq(s.agentSession.runnerId, runner.id),
          inArray(s.agentSession.status, [...activeStatuses]),
        ),
      );
  return sessions.map((x) => {
    const row = rows.find((r) => r.id === x.sessionId);
    const isHeld = held.includes(x);
    return {
      sessionId: x.sessionId,
      held: isHeld,
      status: row?.status ?? null,
      leaseExpiresAt: isHeld ? expires.toISOString() : null,
    };
  });
}

// Revokes a runner's credential at once. Sessions it holds lose their lease
// and return to the queue (or fail after their attempts).
export async function revokeRunner(
  db: Database,
  userId: string,
  organizationId: string,
  runnerId: string,
  now = new Date(),
) {
  return factoryWrite(db, organizationId, async (tx) => {
    const membership = await authorize(tx, userId, organizationId);
    const [current] = await tx
      .select()
      .from(s.runner)
      .where(
        and(
          eq(s.runner.organizationId, organizationId),
          eq(s.runner.id, runnerId),
        ),
      )
      .for("update");
    if (!current)
      throw new DomainError("not_found", "This runner does not exist.");
    const allowed = current.ownerId
      ? current.ownerId === userId || isAdmin(membership)
      : isAdmin(membership);
    if (!allowed)
      throw new DomainError(
        "forbidden",
        current.ownerId
          ? "Only the runner's owner or an organization administrator can revoke it."
          : "Only an organization administrator can revoke an organization runner.",
      );
    if (current.revokedAt) return runnerEntity(current);
    const [row] = await tx
      .update(s.runner)
      .set({ revokedAt: now, revokedById: userId })
      .where(eq(s.runner.id, runnerId))
      .returning();
    // Leases end now; recovery requeues the sessions.
    await tx
      .update(s.agentSession)
      .set({ leaseExpiresAt: now })
      .where(
        and(
          eq(s.agentSession.runnerId, runnerId),
          inArray(s.agentSession.status, [...activeStatuses]),
        ),
      );
    await projectRunner(tx, row!);
    await recordAuditEvent(tx, {
      organizationId,
      actor: { id: userId },
      action: "runner.revoked",
      target: runnerTarget(row!),
      detail: {
        personal: Boolean(row!.ownerId),
        prefix: row!.credentialPrefix,
      },
    });
    return runnerEntity(row!);
  });
}

export async function listRunners(
  db: Database,
  userId: string,
  organizationId: string,
) {
  await authorize(db, userId, organizationId);
  const rows = await db
    .select()
    .from(s.runner)
    .where(
      and(
        eq(s.runner.organizationId, organizationId),
        isNull(s.runner.revokedAt),
      ),
    )
    .orderBy(s.runner.name);
  return rows.map(runnerEntity);
}
