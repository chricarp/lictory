import { Hono, type Context } from "hono";
import { z } from "zod";
import { CapabilityError, httpStatus } from "@lictory/core/capabilities/core";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { db } from "@lictory/core/db";
import { DomainError } from "@lictory/core/domain/errors";
import { proxyModelStream } from "@lictory/core/factory/model-proxy";
import {
  MAX_POLL_SECONDS,
  claimRequest,
  completeRequest,
  eventsRequest,
  heartbeatRequest,
  limits,
  modelRequest,
  registerRequest,
  startRequest,
} from "@lictory/core/factory/protocol";
import {
  authenticateRunner,
  heartbeat,
  registerRunner,
  type RunnerRow,
} from "@lictory/core/factory/runners";
import {
  SequenceGap,
  appendRunnerEvents,
  claimSession,
  completeRun,
  modelAccess,
  readInputs,
  sessionStatusForRunner,
  sessionWorkspace,
  startRun,
} from "@lictory/core/factory/sessions";
import { waitForSignal } from "@lictory/core/factory/signals";
import { limit, noStore } from "@lictory/api/middleware";

// The runner protocol (docs/internals/factory.md#protocol): outbound HTTPS
// from `lictory-runner`, authenticated with its bearer runner credential.
// Thin adapters over factory/runners.ts and factory/sessions.ts, which own
// leases, fencing and every state change.

// Per-runner token buckets: bursts of event batches are fine, a runaway
// loop is not. In-process: each API replica limits independently.
type Bucket = { tokens: number; at: number };
const buckets = new Map<string, Bucket>();
const BUCKET = { capacity: 300, refillPerSecond: 20 };
const REGISTER = { capacity: 10, refillPerSecond: 10 / 60 };

function take(key: string, rule: typeof BUCKET, now = Date.now()) {
  const bucket = buckets.get(key) ?? { tokens: rule.capacity, at: now };
  bucket.tokens = Math.min(
    rule.capacity,
    bucket.tokens + ((now - bucket.at) / 1000) * rule.refillPerSecond,
  );
  bucket.at = now;
  buckets.set(key, bucket);
  if (buckets.size > 10_000)
    for (const [k, b] of buckets)
      if (now - b.at > 10 * 60_000) buckets.delete(k);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

const rateLimited = () =>
  new CapabilityError(
    "validation",
    "Too many requests from this runner. Slow down and retry.",
    { status: 429, kind: "rate_limited", retryable: true },
  );

function failure(error: unknown) {
  if (error instanceof SequenceGap)
    return Response.json(
      {
        error: {
          category: "conflict",
          kind: "sequence_gap",
          message: error.message,
          acked: error.acked,
        },
      },
      { status: 409, headers: noStore },
    );
  const e = toCapabilityError(error);
  if (e.category === "server")
    console.error(
      JSON.stringify({
        event: "runner.error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  return Response.json(
    { error: e.toJSON() },
    {
      status: httpStatus(e),
      headers: {
        ...noStore,
        ...(e.details.kind === "rate_limited" ? { "Retry-After": "2" } : {}),
      },
    },
  );
}

const unauthorized = () =>
  new CapabilityError(
    "unauthorized",
    "This runner credential is invalid or revoked. Register the runner again.",
    { kind: "revoked" },
  );

async function runnerOf(c: Context) {
  const secret = /^Bearer\s+(.+)$/i
    .exec(c.req.header("authorization") ?? "")?.[1]
    ?.trim();
  const runner = secret ? await authenticateRunner(db, secret) : null;
  if (!runner) throw unauthorized();
  if (!take(`runner:${runner.id}`, BUCKET)) throw rateLimited();
  return runner;
}

async function body<T extends z.ZodType>(c: Context, schema: T) {
  const raw: unknown = await c.req.json().catch(() => {
    throw new CapabilityError("validation", "The request body is not JSON.");
  });
  return schema.parse(raw);
}

// Runs a handler for an authenticated runner and answers JSON.
function handle(run: (runner: RunnerRow, c: Context) => Promise<unknown>) {
  return async (c: Context) => {
    try {
      const runner = await runnerOf(c);
      const result = await run(runner, c);
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true }, { headers: noStore });
    } catch (error) {
      return failure(error);
    }
  };
}

const sessionParam = (c: Context) => {
  const id = c.req.param("id");
  if (!id || id.length > 160)
    throw new DomainError("not_found", "This agent session does not exist.");
  return id;
};

const inputsRequest = startRequest.extend({
  after: z.number().int().nonnegative(),
  wait: z.number().int().min(0).max(MAX_POLL_SECONDS).default(MAX_POLL_SECONDS),
});

// Long-polls `check` until it yields or the wait ends; wakes early on a
// Factory signal matching `match`.
async function poll<T>(
  c: Context,
  seconds: number,
  check: () => Promise<T | null>,
  match: Parameters<typeof waitForSignal>[0],
) {
  const deadline = Date.now() + seconds * 1000;
  const abort = c.req.raw.signal;
  for (;;) {
    const found = await check();
    if (found !== null) return found;
    const left = deadline - Date.now();
    if (left <= 0 || abort.aborted) return null;
    // Signals wake the wait; the periodic check covers lost signals.
    await waitForSignal(match, Math.min(left, 3_000), abort);
  }
}

export function runnerRoutes() {
  const app = new Hono();

  // Exchanges a one-time registration token for a runner credential.
  app.post("/api/runner/v1/register", limit(64 * 1024), async (c) => {
    try {
      const address =
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "direct";
      if (!take(`register:${address}`, REGISTER)) throw rateLimited();
      const request = await body(c, registerRequest);
      return Response.json(await registerRunner(db, request), {
        headers: noStore,
      });
    } catch (error) {
      return failure(error);
    }
  });

  app.post(
    "/api/runner/v1/heartbeat",
    limit(64 * 1024),
    handle(async (runner, c) =>
      heartbeat(db, runner, await body(c, heartbeatRequest)),
    ),
  );

  // Long-polls for an assignment; 204 when nothing was claimable in time.
  app.post(
    "/api/runner/v1/claim",
    limit(8 * 1024),
    handle(async (runner, c) => {
      const { wait } = await body(c, claimRequest);
      const assignment = await poll(
        c,
        wait,
        () => claimSession(db, runner),
        (signal) => signal.organizationId === runner.organizationId,
      );
      return (
        assignment ?? new Response(null, { status: 204, headers: noStore })
      );
    }),
  );

  app.post(
    "/api/runner/v1/sessions/:id/start",
    limit(8 * 1024),
    handle(async (runner, c) => {
      const { leaseToken } = await body(c, startRequest);
      return startRun(db, runner, sessionParam(c), leaseToken);
    }),
  );

  app.post(
    "/api/runner/v1/sessions/:id/events",
    limit(limits.batchBytes + 64 * 1024),
    handle(async (runner, c) => {
      const { leaseToken, events } = await body(c, eventsRequest);
      return appendRunnerEvents(
        db,
        runner,
        sessionParam(c),
        leaseToken,
        events,
      );
    }),
  );

  // Long-polls the steering inbox after `after`.
  app.post(
    "/api/runner/v1/sessions/:id/inputs",
    limit(8 * 1024),
    handle(async (runner, c) => {
      const id = sessionParam(c);
      const { leaseToken, after, wait } = await body(c, inputsRequest);
      // The first read checks (and renews) the lease even when idle.
      const first = await readInputs(db, runner, id, leaseToken, after);
      if (first.inputs.length || wait === 0) return first;
      const found = await poll(
        c,
        wait,
        async () => {
          const current = await sessionStatusForRunner(db, runner, id);
          // Read again only when something new may be there.
          if (current && current.inputSequence <= after) return null;
          const next = await readInputs(db, runner, id, leaseToken, after);
          return next.inputs.length ? next : null;
        },
        (signal) => signal.sessionId === id,
      );
      return found ?? (await readInputs(db, runner, id, leaseToken, after));
    }),
  );

  app.post(
    "/api/runner/v1/sessions/:id/workspace",
    limit(8 * 1024),
    handle(async (runner, c) => {
      const { leaseToken } = await body(c, startRequest);
      return sessionWorkspace(db, runner, sessionParam(c), leaseToken);
    }),
  );

  app.post(
    "/api/runner/v1/sessions/:id/complete",
    limit(64 * 1024),
    handle(async (runner, c) => {
      const request = await body(c, completeRequest);
      return completeRun(db, runner, sessionParam(c), request);
    }),
  );

  // The built-in harness's model calls, streamed as NDJSON.
  app.post(
    "/api/runner/v1/sessions/:id/model",
    limit(limits.modelRequestBytes, "The model request is too large."),
    handle(async (runner, c) => {
      const { leaseToken, call } = await body(c, modelRequest);
      await modelAccess(db, runner, sessionParam(c), leaseToken);
      const stream = await proxyModelStream(call, {
        signal: c.req.raw.signal,
      });
      return new Response(stream, {
        headers: {
          ...noStore,
          "Content-Type": "application/x-ndjson; charset=utf-8",
        },
      });
    }),
  );

  return app;
}
