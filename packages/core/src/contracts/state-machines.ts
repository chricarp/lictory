// Declared state machines (docs/internals/state-machines.md).
//
// A status that people move is declared here once: its states, the steps
// between them and why a step is refused. The server's commands refuse from
// this table (`requireStep`), the browser offers only what it allows, and the
// descriptions agents read are generated from it. A rule written anywhere
// else is a copy that will drift.
//
// This module knows states, not people: who may take a step stays with the
// capability checks of the command that performs it.

type Step<S extends string> = {
  // What the step does, as the start of a sentence: "Merge", "Mark ready".
  does: string;
  from: readonly S[];
  // The state afterwards: several when the caller chooses one, none when the
  // state stays as it is.
  to?: S | readonly S[];
  // Asking for the state the entity is already in is accepted and changes
  // nothing.
  idempotent?: true;
  // The server takes this step as a consequence of other facts. Nobody can
  // ask for it, so it is never offered.
  automatic?: true;
  // The refusal from a state outside `from`, in the words the person reads.
  refused: string | ((state: S) => string);
};

export type StateMachine<S extends string, A extends string> = {
  // The entity as people call it: "pull request", "suggestion".
  name: string;
  // Every state and what it means.
  states: Readonly<Record<S, string>>;
  // States read from other columns (a deletion time) instead of the status.
  derived: readonly S[];
  steps: Readonly<Record<A, Step<S>>>;
  // The step can be taken from this state.
  allows(state: S, step: A): boolean;
  // Why the step is refused from this state; undefined when it is allowed.
  refusal(state: S, step: A): string | undefined;
  // The states the step can lead to (empty when it does not move).
  targets(step: A): readonly S[];
  // The steps a person can ask for from this state.
  available(state: S): A[];
  // States no step leaves.
  final: readonly S[];
  // One sentence per step, for the descriptions agents and people read.
  rule(...steps: A[]): string;
};
export type StateOf<M> = M extends StateMachine<infer S, string> ? S : never;

const words = (state: string) => state.replaceAll("_", " ");
const list = (states: readonly string[]) => {
  const named = states.map(words);
  return named.length < 2
    ? (named[0] ?? "")
    : `${named.slice(0, -1).join(", ")} or ${named.at(-1)}`;
};

export function stateMachine<S extends string, A extends string>(definition: {
  name: string;
  states: Record<S, string>;
  derived?: readonly S[];
  steps: Record<A, Step<S>>;
}): StateMachine<S, A> {
  const { name, states, steps } = definition;
  const targets = (step: A): readonly S[] => {
    const to = steps[step].to;
    return to === undefined ? [] : typeof to === "string" ? [to] : to;
  };
  const allows = (state: S, step: A) => steps[step].from.includes(state);
  const moving = (Object.keys(steps) as A[]).filter((step) =>
    targets(step).some((to) => steps[step].from.some((from) => from !== to)),
  );
  return {
    name,
    states,
    derived: definition.derived ?? [],
    steps,
    allows,
    targets,
    refusal(state, step) {
      const { idempotent, refused } = steps[step];
      if (allows(state, step)) return undefined;
      if (idempotent && targets(step).includes(state)) return undefined;
      return typeof refused === "string" ? refused : refused(state);
    },
    available: (state) =>
      (Object.keys(steps) as A[]).filter(
        (step) => !steps[step].automatic && allows(state, step),
      ),
    final: (Object.keys(states) as S[]).filter(
      (state) => !moving.some((step) => steps[step].from.includes(state)),
    ),
    rule: (...chosen) => {
      const outcome = (step: A) => {
        const to = targets(step);
        return to.length ? ` (it becomes ${list(to)})` : "";
      };
      // Steps allowed from the same states share one sentence.
      const groups = new Map<string, A[]>();
      for (const step of chosen) {
        const from = list(steps[step].from);
        groups.set(from, [...(groups.get(from) ?? []), step]);
      }
      return [...groups]
        .map(([from, group]) =>
          group.length === 1
            ? `${steps[group[0]!].does} while the ${name} is ${from}${outcome(group[0]!)}.`
            : `While the ${name} is ${from}: ${group
                .map(
                  (step) =>
                    `${steps[step].does.charAt(0).toLowerCase()}${steps[step].does.slice(1)}${outcome(step)}`,
                )
                .join("; ")}.`,
        )
        .join(" ");
    },
  };
}

// ------------------------------------------------------- specifications

// A proposal to merge a specification branch into another line. Closing one
// removes it from the item; the merged text stays in the specification.
export const specificationPullRequest = stateMachine({
  name: "pull request",
  states: {
    draft: "Being prepared; reviewers are not asked to decide yet.",
    open: "Ready for review and, once its requirements are met, for merging.",
    merged: "Its result is part of the target line.",
    closed: "Removed from the item by its author or a specification editor.",
  },
  derived: ["closed"],
  steps: {
    markDraft: {
      does: "Mark as draft",
      from: ["open"],
      to: "draft",
      idempotent: true,
      refused: "Merged pull requests cannot become drafts.",
    },
    markReady: {
      does: "Mark ready for review",
      from: ["draft"],
      to: "open",
      idempotent: true,
      refused: "A merged pull request cannot be marked ready for review.",
    },
    requestReview: {
      does: "Request a review",
      from: ["draft", "open"],
      refused: "This pull request is merged.",
    },
    requestAction: {
      does: "Ask Lictory Intelligence for a review",
      from: ["draft", "open"],
      refused: "This pull request is not open for review.",
    },
    discuss: {
      does: "Start a discussion",
      from: ["draft", "open"],
      refused: "This pull request is unavailable for discussion.",
    },
    review: {
      does: "Approve, request changes or revoke a decision",
      from: ["open"],
      refused: (state) =>
        state === "draft"
          ? "This pull request is a draft. Mark it ready for review first."
          : "This pull request is merged.",
    },
    merge: {
      does: "Merge",
      from: ["open"],
      to: "merged",
      refused: "Only an open pull request can be merged.",
    },
    close: {
      does: "Close",
      from: ["draft", "open", "merged"],
      to: "closed",
      refused: "This branch or pull request is unavailable.",
    },
  },
});

// Legacy proposals of replacement text, reviewed like a small pull request.
export const suggestion = stateMachine({
  name: "suggestion",
  states: {
    draft: "Private to its author.",
    open: "Open for review by its assigned reviewers.",
    merged: "Applied to the specification as a new revision.",
    closed: "Set aside without being applied; it can be reopened.",
  },
  steps: {
    returnToDraft: {
      does: "Return to draft",
      from: ["open", "closed"],
      to: "draft",
      idempotent: true,
      refused: "A merged suggestion cannot change state.",
    },
    openForReview: {
      does: "Open for review",
      from: ["draft", "closed"],
      to: "open",
      idempotent: true,
      refused: "A merged suggestion cannot change state.",
    },
    close: {
      does: "Close",
      from: ["draft", "open"],
      to: "closed",
      idempotent: true,
      refused: "A merged suggestion cannot change state.",
    },
    update: {
      does: "Change the proposed text, title or rationale",
      from: ["draft", "open"],
      refused: (state) => `This suggestion was ${state}; open a new one.`,
    },
    setReviewer: {
      does: "Assign or unassign a reviewer",
      from: ["draft", "open"],
      refused: (state) => `This suggestion was ${state}.`,
    },
    discuss: {
      does: "Start a discussion",
      from: ["draft", "open"],
      refused: "This suggestion is no longer open for discussion.",
    },
    review: {
      does: "Approve, request changes or revoke a decision",
      from: ["open"],
      refused: "This suggestion is not open for review.",
    },
    merge: {
      does: "Merge",
      from: ["open"],
      to: "merged",
      refused: "Only an open suggestion can be merged.",
    },
  },
});

// A request for a discipline (or one of its members) to evaluate a revision.
// The approval itself is a separate record that names the revision.
export const review = stateMachine({
  name: "review",
  states: {
    requested: "Waiting for the reviewer's decision.",
    in_progress: "Reserved: nothing sets it. Read it as requested.",
    changes_requested: "The reviewer asked for changes to this revision.",
    completed: "The reviewer approved this revision.",
    cancelled: "Withdrawn by someone who can request reviews.",
  },
  steps: {
    approve: {
      does: "Approve",
      from: ["requested", "in_progress", "changes_requested", "completed"],
      to: "completed",
      refused: "This review was cancelled.",
    },
    requestChanges: {
      does: "Request changes",
      from: ["requested", "in_progress", "changes_requested", "completed"],
      to: "changes_requested",
      refused: "This review was cancelled.",
    },
    revoke: {
      does: "Revoke a decision",
      from: ["requested", "in_progress", "changes_requested", "completed"],
      to: "requested",
      refused: "This review was cancelled.",
    },
    cancel: {
      does: "Cancel",
      from: ["requested", "in_progress", "changes_requested", "completed"],
      to: "cancelled",
      refused: "This review is not active.",
    },
  },
});

// The refinement states a person can choose. `ready` is never chosen: it
// follows from readiness evidence (AGENTS.md, "Readiness is evidence").
export const chosenRefinementStates = [
  "draft",
  "refinement",
  "in_review",
] as const;

// Where a specification stands in refinement. Separate from delivery status.
export const refinement = stateMachine({
  name: "specification",
  states: {
    draft: "A proposal that has not started refinement.",
    refinement: "Being clarified.",
    in_review: "Its current revision is being reviewed.",
    ready: "Every readiness check passes for the current revision.",
  },
  steps: {
    move: {
      does: "Move between draft, refinement and in review",
      from: chosenRefinementStates,
      to: chosenRefinementStates,
      refused:
        "This item still meets its readiness checks, so it stays ready. Change the specification or the checks before moving it back.",
    },
    reviewRequested: {
      does: "Enter review when the first review is requested",
      from: ["draft", "refinement"],
      to: "in_review",
      automatic: true,
      refused: "Requesting a review does not change this state.",
    },
    becomeReady: {
      does: "Become ready when every readiness check passes",
      from: chosenRefinementStates,
      to: "ready",
      automatic: true,
      refused: "This item is already ready.",
    },
    loseReadiness: {
      does: "Return to review when a readiness check stops passing",
      from: ["ready"],
      to: "in_review",
      automatic: true,
      refused: "This item is not ready.",
    },
  },
});

// ------------------------------------------------------------- delivery

// A sprint (started and completed by hand) or a cycle (the schedule takes
// the same steps). A completed iteration is history.
export const iteration = stateMachine({
  name: "iteration",
  states: {
    planned: "Not started; work can be planned into it.",
    active: "Underway. One iteration per project is active at a time.",
    completed: "Finished; its report is frozen.",
  },
  steps: {
    plan: {
      does: "Plan work into it",
      from: ["planned", "active"],
      refused: "That iteration is completed. Choose an active or planned one.",
    },
    start: {
      does: "Start",
      from: ["planned"],
      to: "active",
      refused: "Only a planned iteration can be started.",
    },
    complete: {
      does: "Complete",
      from: ["active"],
      to: "completed",
      refused: "Only the active iteration can be completed.",
    },
  },
});

// --------------------------------------------------------------- spaces

// A proposal to merge one line of a page into another. Closing keeps the
// row, its reviews and its discussions, and resolves the open ones.
export const pagePullRequest = stateMachine({
  name: "page pull request",
  states: {
    draft: "Being prepared; reviewers are not asked to decide yet.",
    open: "Ready for review and, once nothing blocks it, for merging.",
    merged: "Its result is part of the target line. Merged is history.",
    closed: "Closed without merging; its reviews and discussions are kept.",
  },
  derived: ["closed"],
  steps: {
    markDraft: {
      does: "Mark as draft",
      from: ["open"],
      to: "draft",
      idempotent: true,
      refused: "This pull request is merged.",
    },
    markReady: {
      does: "Mark ready for review",
      from: ["draft"],
      to: "open",
      idempotent: true,
      refused: "This pull request is merged.",
    },
    edit: {
      does: "Change the title or description",
      from: ["draft", "open"],
      refused: "This pull request is merged.",
    },
    requestReview: {
      does: "Request or withdraw a review request",
      from: ["draft", "open"],
      refused: "This pull request is merged.",
    },
    discuss: {
      does: "Start a discussion",
      from: ["draft", "open"],
      refused: (state) =>
        state === "merged"
          ? "This pull request is merged. Comment on the page instead."
          : "This pull request is unavailable on this page.",
    },
    review: {
      does: "Approve, request changes or revoke a decision",
      from: ["open"],
      refused: (state) =>
        state === "draft"
          ? "This pull request is a draft. Mark it ready for review first."
          : "This pull request is merged.",
    },
    merge: {
      does: "Merge",
      from: ["open"],
      to: "merged",
      refused: (state) =>
        state === "draft"
          ? "This pull request is a draft. Mark it ready for review first."
          : "This pull request is already merged.",
    },
    close: {
      does: "Close",
      from: ["draft", "open"],
      to: "closed",
      refused: "A merged pull request is history and cannot be deleted.",
    },
  },
});

// The state of a pull request row: closing is recorded as a deletion time
// beside the stored status.
export function pullRequestState<S extends string>(row: {
  status: S;
  deletedAt?: unknown;
}): S | "closed" {
  return row.deletedAt ? "closed" : row.status;
}

// A pull request that can still change: neither merged nor closed.
export const pullRequestIsActive = (row: {
  status: string;
  deletedAt?: unknown;
}) => !row.deletedAt && row.status !== "merged";

// ----------------------------------------------- every stored status

// How a stored status moves when no table above declares it. Each kind has
// one owner, named so the rule is found without searching:
// - `toggle`: two states, both directions always allowed.
// - `free`: a label people set to any value; rules would be a workflow
//   builder, which Lictory does not have.
// - `consequence`: written only as the result of another command or fact.
// - `job`: background work claimed and settled under a lease by one module.
// - `external`: written by a library; Lictory only reads it.
export type StatusOwner = {
  moves: "toggle" | "free" | "consequence" | "job" | "external";
  owner: string;
};

type AnyStateMachine = StateMachine<string, string>;
const declared = (machine: unknown) => machine as AnyStateMachine;

// Every database column that holds a status or state, by enum name or
// `table.column` for text columns, and what decides how it moves.
// `state-machines.test.ts` reads the schema and fails when a column is
// missing here or a declared machine and its enum disagree.
export const statusColumns: Record<string, AnyStateMachine | StatusOwner> = {
  refinement_state: declared(refinement),
  review_status: declared(review),
  suggestion_status: declared(suggestion),
  iteration_state: declared(iteration),
  page_pull_request_status: declared(pagePullRequest),
  "specification_pull_request.status": declared(specificationPullRequest),
  thread_status: {
    moves: "toggle",
    owner: "updateThread in domain/service.ts",
  },
  page_thread_status: {
    moves: "toggle",
    owner: "resolvePageThread and reopenPageThread in spaces/discussions.ts",
  },
  milestone_status: {
    moves: "free",
    owner: "updateMilestone in domain/service.ts",
  },
  approval_status: {
    moves: "consequence",
    owner:
      "decideReview and new revisions in domain/service.ts; merges in domain/branches.ts",
  },
  check_status: {
    moves: "consequence",
    owner:
      "nothing writes it: readiness is computed from evidence (contracts/readiness.ts)",
  },
  delivery_sync_status: {
    moves: "consequence",
    owner: "exports and refreshes in delivery/service.ts",
  },
  delivery_connection_status: {
    moves: "consequence",
    owner:
      "connecting and provider authentication errors in delivery/service.ts",
  },
  ai_run_status: {
    moves: "job",
    owner: "claim and finish in ai/runner.ts; requests in domain/ai.ts",
  },
  delivery_publication_status: {
    moves: "job",
    owner: "the publication runner in delivery/service.ts",
  },
  notification_email_status: {
    moves: "job",
    owner: "claim and settle in notifications/email.ts",
  },
  "organization_export.status": {
    moves: "job",
    owner: "claim and settle in export/service.ts",
  },
  "organization_deletion.status": {
    moves: "job",
    owner:
      "schedule, cancel, claim and settle in domain/organization-deletion.ts",
  },
  "intelligence_chat_run.status": {
    moves: "job",
    owner: "intelligence/chat/runs.ts",
  },
  "invitation.status": {
    moves: "external",
    owner: "Better Auth's organization plugin",
  },
};
