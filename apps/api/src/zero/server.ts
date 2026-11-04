import { timingSafeEqual } from "node:crypto";
import {
  ApplicationError,
  defineMutator,
  defineMutators,
  mustGetMutator,
  mustGetQuery,
} from "@rocicorp/zero";
import { handleMutateRequest, handleQueryRequest } from "@rocicorp/zero/server";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import type { ZeroContext } from "@lictory/zero/context";
import { mutators } from "@lictory/zero/mutators";
import { queries } from "@lictory/zero/queries";
import { schema } from "@lictory/zero/schema";
import { toCapabilityError } from "@lictory/core/capabilities/errors";
import { mutationSchema } from "@lictory/core/contracts/protocol";
import { env } from "@lictory/core/lib/env";
import {
  applyMutation,
  type Database,
  type MutationOutcome,
  type Tx,
} from "@lictory/core/domain/service";
import {
  heldOrganizations,
  twoFactorRequiredError,
} from "@lictory/core/domain/two-factor-policy";

// Zero's custom query and mutate endpoints. zero-cache calls them with the
// browser's forwarded cookies; the host resolves the session and passes the
// verified user id. Domain errors become Zero application errors whose
// `details` follow the capability error shape, so the client can show the
// same messages as every other surface.

// The server context adds the host's post-commit hook to Zero's context.
type ServerContext = ZeroContext & {
  applied?: (outcome: MutationOutcome) => void;
};

// Postgres asks the client to retry these (serialization failure, deadlock).
const retryable = new Set(["40001", "40P01"]);
function isRetryable(error: unknown): boolean {
  for (
    let e = error;
    e && typeof e === "object";
    e = (e as { cause?: unknown }).cause
  )
    if (retryable.has(String((e as { code?: unknown }).code))) return true;
  return false;
}

function applicationError(error: unknown) {
  const normalized = toCapabilityError(error);
  if (normalized.category === "server")
    console.error(
      JSON.stringify({
        event: "zero.mutate.error",
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      }),
    );
  return new ApplicationError(normalized.message, {
    details: normalized.toJSON(),
  });
}

// The shared mutators with `workspace.apply` replaced by the domain command,
// run inside Zero's transaction so domain writes, projections, the
// idempotency receipt and Zero's own bookkeeping commit together.
export const serverMutators = defineMutators(mutators, {
  workspace: {
    apply: defineMutator(async ({ tx, args, ctx }) => {
      if (tx.location !== "server")
        throw new Error(
          "workspace.apply on the server needs a server transaction.",
        );
      tx.retryOn((error) => isRetryable(error));
      const parsed = mutationSchema.safeParse(args);
      if (!parsed.success) throw applicationError(parsed.error);
      const context = ctx as ServerContext;
      try {
        await applyMutation(
          tx.dbTransaction.wrappedTransaction as Tx,
          { userId: context.userID },
          parsed.data,
          { applied: context.applied },
        );
      } catch (error) {
        if (isRetryable(error)) throw error;
        throw applicationError(error);
      }
    }),
  },
});

export function createZeroEndpoints(
  db: Database,
  options: {
    // Runs after a mutation committed (analytics); never inside it.
    onCommitted?: (outcome: MutationOutcome, request: Request) => void;
  } = {},
) {
  const dbProvider = zeroDrizzle(schema, db);
  // Domain rejections are expected outcomes, not server problems; Zero's
  // per-mutation warnings would otherwise log each one with a stack.
  const logLevel =
    (env("ZERO_SERVER_LOG_LEVEL") as
      "debug" | "info" | "warn" | "error" | undefined) ?? "error";
  return {
    async query(request: Request, userID: string) {
      // Organizations whose two-factor requirement this person does not
      // meet yet: their data is not synchronized until they enroll.
      const held = new Set(
        (await heldOrganizations(db, userID)).map((o) => o.id),
      );
      return handleQueryRequest({
        handler: (name, args) => {
          const organizationId =
            args && typeof args === "object" && "organizationId" in args
              ? args.organizationId
              : undefined;
          if (typeof organizationId === "string" && held.has(organizationId))
            throw applicationError(twoFactorRequiredError());
          const query = mustGetQuery(queries, name);
          const ctx: ZeroContext = { userID };
          return query.fn({ args, ctx });
        },
        schema,
        request,
        userID,
        logLevel,
      });
    },
    mutate(request: Request, userID: string) {
      return handleMutateRequest({
        dbProvider,
        userID,
        request,
        logLevel,
        handler: async (transact) => {
          let outcome: MutationOutcome | undefined;
          const ctx: ServerContext = {
            userID,
            // Retries re-run the mutator; the last run is the committed one.
            applied: (o) => {
              outcome = o;
            },
          };
          const response = await transact((tx, name, args) =>
            mustGetMutator(serverMutators, name).fn({ tx, args, ctx }),
          );
          if (outcome && !outcome.replayed && !("error" in response.result))
            try {
              options.onCommitted?.(outcome, request);
            } catch {
              // Observability cannot fail a committed mutation.
            }
          return response;
        },
      });
    },
  };
}

// zero-cache authenticates itself with `X-Api-Key` when
// ZERO_QUERY_API_KEY / ZERO_MUTATE_API_KEY are configured on both sides.
export function validApiKey(
  expected: string | undefined,
  given: string | null,
) {
  if (!expected) return true;
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
