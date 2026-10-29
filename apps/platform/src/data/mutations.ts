import type { Command, Mutation } from "@lictory/core/contracts/protocol";
import {
  carriesAuthoredText,
  type RecoveryStore,
} from "@lictory/platform/data/recovery";

// What a Zero mutator call reports, reduced to what the workspace needs.
export type MutationOutcome =
  | { readonly type: "success" }
  | {
      readonly type: "error";
      readonly error:
        | {
            readonly type: "app";
            readonly message: string;
            readonly details?: unknown;
          }
        | { readonly type: "zero"; readonly message: string };
    };
export type MutationCall = {
  client: Promise<MutationOutcome>;
  server: Promise<MutationOutcome>;
};

export type RejectionCategory =
  | "unauthorized"
  | "forbidden"
  | "unavailable"
  | "not_found"
  | "validation"
  | "conflict"
  | "server";
export type RejectionDetails = {
  category: RejectionCategory;
  message: string;
  currentRevisionId?: string;
  issues?: unknown;
};

// Thrown by confirmed mutations; `details` carries the domain answer.
export class MutationRejected extends Error {
  constructor(
    message: string,
    readonly mutationId: string,
    readonly details: RejectionDetails,
  ) {
    super(message);
    this.name = "MutationRejected";
  }
}

const categories = new Set<string>([
  "unauthorized",
  "forbidden",
  "unavailable",
  "not_found",
  "validation",
  "conflict",
  "server",
]);

export function rejectionOf(
  outcome: Extract<MutationOutcome, { type: "error" }>,
): RejectionDetails {
  const error = outcome.error;
  if (error.type === "zero")
    return {
      category: "unavailable",
      message: /offline|disconnect|closed|connect/i.test(error.message)
        ? "You’re offline or the connection was interrupted, so this change was not saved."
        : error.message || "This change could not be sent.",
    };
  const raw = error.details;
  if (raw && typeof raw === "object") {
    const d = raw as Record<string, unknown>;
    const category =
      typeof d.category === "string" && categories.has(d.category)
        ? (d.category as RejectionCategory)
        : "server";
    return {
      category,
      message:
        typeof d.message === "string" && d.message
          ? d.message
          : error.message || "This change could not be saved.",
      currentRevisionId:
        typeof d.currentRevisionId === "string"
          ? d.currentRevisionId
          : undefined,
      issues: d.issues,
    };
  }
  return {
    category: "server",
    message: error.message || "This change could not be saved.",
  };
}

export type PendingMutation = { mutation: Mutation; enqueuedAt: number };

// Mutations sent to the server whose answer has not arrived yet.
export class PendingTracker {
  private items: PendingMutation[] = [];
  private listeners = new Set<() => void>();
  add(mutation: Mutation) {
    this.items = [...this.items, { mutation, enqueuedAt: Date.now() }];
    this.emit();
  }
  remove(id: string) {
    if (!this.items.some((p) => p.mutation.id === id)) return;
    this.items = this.items.filter((p) => p.mutation.id !== id);
    this.emit();
  }
  private emit() {
    for (const listener of this.listeners) listener();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.items;
}

export type Rejection = {
  mutationId: string;
  command: Command;
  message: string;
  // The authored text is kept in the recovery store.
  recoverable: boolean;
};

export function createMutationRunner(deps: {
  apply: (mutation: Mutation) => MutationCall;
  pending: PendingTracker;
  recovery: RecoveryStore;
  onRejected: (rejection: Rejection) => void;
}) {
  const settle = (
    mutation: Mutation,
    confirmed: boolean,
    outcome: MutationOutcome,
  ) => {
    const id = mutation.id;
    deps.pending.remove(id);
    if (outcome.type === "success") {
      deps.recovery.remove(id);
      return undefined;
    }
    const details = rejectionOf(outcome);
    const recoverable = carriesAuthoredText(mutation.command);
    // A confirmed caller keeps its own draft and shows the error in place.
    if (confirmed) deps.recovery.remove(id);
    else {
      if (recoverable) deps.recovery.reject(id, details.message);
      deps.onRejected({
        mutationId: id,
        command: mutation.command,
        message: details.message,
        recoverable,
      });
    }
    return details;
  };

  // Resolves once the change is applied locally (optimistic commands) or
  // queued (server-validated ones). Rejections are reported asynchronously.
  async function run(mutation: Mutation) {
    const { client } = start(mutation, false);
    await client;
    return mutation.id;
  }

  // Resolves after the server accepted the change; throws MutationRejected.
  async function confirm(mutation: Mutation) {
    const details = await start(mutation, true).server;
    if (details)
      throw new MutationRejected(details.message, mutation.id, details);
    return mutation.id;
  }

  function start(mutation: Mutation, confirmed: boolean) {
    if (carriesAuthoredText(mutation.command))
      deps.recovery.put({
        id: mutation.id,
        organizationId: mutation.organizationId,
        command: mutation.command,
      });
    deps.pending.add(mutation);
    let call: MutationCall;
    try {
      call = deps.apply(mutation);
    } catch (error) {
      const outcome: MutationOutcome = {
        type: "error",
        error: {
          type: "zero",
          message:
            error instanceof Error
              ? error.message
              : "This change could not be sent.",
        },
      };
      const server = Promise.resolve(settle(mutation, confirmed, outcome));
      return { client: server.then(() => undefined), server };
    }
    const client = call.client.then(
      () => undefined,
      () => undefined,
    );
    const server = call.server.then(
      (outcome) => settle(mutation, confirmed, outcome),
      (error: unknown) =>
        settle(mutation, confirmed, {
          type: "error",
          error: {
            type: "zero",
            message:
              error instanceof Error
                ? error.message
                : "This change could not be sent.",
          },
        }),
    );
    return { client, server };
  }

  return { run, confirm };
}
