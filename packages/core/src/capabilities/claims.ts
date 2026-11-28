import { z } from "zod";
import {
  autonomyLevels,
  autonomyPolicyInputSchema,
  autopilotRequirements,
  doneCheckDefinitionSchema,
} from "@lictory/core/claims/contracts";
import {
  askQuestion,
  autonomyPolicyOf,
  claimItem,
  definitionOfDoneOf,
  dispatchState,
  listClaimable,
  listLiveClaims,
  overrideDoneCheck,
  releaseClaim,
  renewClaim,
  reportProgress,
  retryDispatch,
  setAutonomyPolicy,
  setDefinitionOfDone,
  signOffDoneCheck,
} from "@lictory/core/claims/service";
import { claim } from "@lictory/core/contracts/state-machines";
import type { Actor } from "@lictory/core/domain/service";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";

// The factory loop's capabilities (docs/internals/claims.md): agents find
// claimable work, claim it on a lease, report progress and ask people;
// people release claims, set the autonomy policy and the Definition of Done,
// and sign off. Every rule lives in claims/service.ts; this module only
// describes and validates.

function actor(ctx: CapabilityContext): Actor {
  const p = ctx.principal;
  return {
    userId: p.userId,
    surface: p.surface,
    client: p.client,
    // A Factory agent is named by its own id; other MCP agents by their
    // access token's (as in workspace commands).
    agentId: p.agent?.id ?? p.tokenId ?? null,
    agentName: p.agent?.name ?? p.agentName ?? null,
    agentSessionId: p.agent?.sessionId ?? null,
    agentScope: p.agent ?? null,
  };
}

const mutationId = z
  .uuid()
  .optional()
  .describe(
    "Idempotency key. Retrying with the same value never applies the command twice.",
  );
const claimId = id.describe("The claim (from claimItem or listClaims).");

const listClaimableItems = defineCapability({
  name: "listClaimableItems",
  title: "List claimable work",
  description:
    "Work items an agent can claim now, in rank order: native delivery, not started, every blocking item done, nobody holding it, and allowed to start by the readiness policy (a specification Ready with its scope accepted; plain work covered by its parent specification's accepted scope, or selected into an unstarted status), and no pull request a person opened is linked to it (someone already does that work; a person may still start an agent on it). With `all`, also items that cannot be claimed yet, each with its `stage` (needs_agreement, blocked, claimed) and the reasons. External-delivery projects have no claimable work.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id.optional(),
    all: z
      .boolean()
      .optional()
      .describe("Include items that cannot be claimed yet, with reasons."),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  run: (ctx, input) => listClaimable(ctx.db, ctx.principal.userId, input),
});

const listClaims = defineCapability({
  name: "listClaims",
  title: "List claims",
  description:
    "Live claims (starting, active or waiting on a question) of the organization or one project, with the agent, the person it acts for and the lease. `mine` limits them to claims held by the calling agent.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    projectId: id.optional(),
    mine: z
      .boolean()
      .optional()
      .describe("true lists only claims held by the calling agent."),
  }),
  run: (ctx, input) => listLiveClaims(ctx.db, actor(ctx), input),
});

const claimItemCapability = defineCapability({
  name: "claimItem",
  title: "Claim work item",
  description: `Agents: take a lease on one claimable work item (see listClaimableItems) and start it: the item moves to the project's first started status, attributed to you acting for your person. The lease lasts 15 minutes; keep it with renewClaim or reportProgress. Refused with kind \`not_claimable\` and the reasons when the item cannot be claimed, and \`external_delivery\` in projects delivered by an external tool. Exactly one live claim holds an item; claiming one you already hold returns your claim with \`alreadyHeld\`. Done follows from the Definition of Done (merged pull request, passing checks, sign-offs), never from your report.`,
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({ organizationId, workItemId: id, mutationId }),
  run: (ctx, input) => claimItem(ctx.db, actor(ctx), input),
});

const renewClaimCapability = defineCapability({
  name: "renewClaim",
  title: "Renew claim",
  description: `The agent holding a claim extends its lease (default 15 minutes, 60 to 3600 seconds). ${claim.rule("renew")} A claim whose lease ran out is released by the next sweep and the item returns to the queue.`,
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    claimId,
    leaseSeconds: z
      .number()
      .int()
      .min(60)
      .max(3600)
      .optional()
      .describe("New lease length in seconds (default 900, 15 minutes)."),
  }),
  run: (ctx, input) => renewClaim(ctx.db, actor(ctx), input),
});

const releaseClaimCapability = defineCapability({
  name: "releaseClaim",
  title: "Release claim",
  description: `Give a claimed item back without completing it, with an optional note. The item returns to the status it had before the claim started, unless someone moved it since. Allowed for the agent holding it, its person, project administrators and people who change properties in the project. ${claim.rule("release")} A claim the dispatcher started that a person releases is not dispatched again until someone retries it.`,
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  input: z.object({
    organizationId,
    claimId,
    note: z
      .string()
      .trim()
      .max(2000)
      .optional()
      .describe("Why the work is given back, kept in the item's activity."),
    mutationId,
  }),
  run: (ctx, input) => releaseClaim(ctx.db, actor(ctx), input),
});

const reportProgressCapability = defineCapability({
  name: "reportProgress",
  title: "Report progress",
  description: `The agent holding a claim adds a progress note to the item's activity (what is done, what is next). It renews the lease and never changes the item's status: done follows from evidence. ${claim.rule("report")}`,
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    claimId,
    note: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .describe("What is done and what is next, added to the item's activity."),
    mutationId,
  }),
  run: (ctx, input) => reportProgress(ctx.db, actor(ctx), input),
});

const askQuestionCapability = defineCapability({
  name: "askQuestion",
  title: "Ask a question about the specification",
  description: `The agent holding a claim asks people about the exact specification text it works against: a blocking discussion on the claimed item's specification (or its nearest specification ancestor's) anchored to \`section\` (a heading; empty for the whole text) and \`quote\` (text copied exactly from it). The item's reviewers are mentioned and notified, and the claim waits until a person resolves the discussion; you are told when it is resolved. A blocking question also blocks readiness, so related work waits too. Questions never change the specification. ${claim.rule("ask")}`,
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    claimId,
    question: z
      .string()
      .trim()
      .min(1)
      .max(10_000)
      .describe("The question for people, in Markdown."),
    section: z
      .string()
      .max(200)
      .describe(
        "Heading the question is about; an empty string for the whole text.",
      ),
    quote: z
      .string()
      .max(2000)
      .optional()
      .describe("The exact specification text the question is about."),
    occurrence: z
      .number()
      .int()
      .min(0)
      .max(10_000)
      .optional()
      .describe(
        "When the quote appears more than once under its section: which appearance (0 is the first).",
      ),
    mutationId,
  }),
  run: (ctx, input) => askQuestion(ctx.db, actor(ctx), input),
});

const retryDispatchCapability = defineCapability({
  name: "retryDispatch",
  title: "Retry dispatching an item",
  description:
    "Clear the dispatcher's hold or backoff on an item (after failed session starts, or a person releasing it), so Build and Autopilot may start it again. Project administrators and people who change properties in the project.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({ organizationId, workItemId: id, mutationId }),
  run: (ctx, input) => retryDispatch(ctx.db, actor(ctx), input),
});

const getDispatchState = defineCapability({
  name: "getDispatchState",
  title: "Get dispatch state",
  description:
    "Items of a project the dispatcher is backing off or holding, with the last failure.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, projectId: id }),
  run: (ctx, input) => dispatchState(ctx.db, ctx.principal.userId, input),
});

const getAutonomyPolicy = defineCapability({
  name: "getAutonomyPolicy",
  title: "Get autonomy policy",
  description: `A project's autonomy policy (${autonomyLevels.join(", ")}; Assist when never set), the agents the Factory offers for it, the claims in flight and the policy's recent history.`,
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, projectId: id }),
  run: (ctx, input) => autonomyPolicyOf(ctx.db, ctx.principal.userId, input),
});

const setAutonomyPolicyCapability = defineCapability({
  name: "setAutonomyPolicy",
  title: "Set autonomy policy",
  description: `Project administrators: choose how much the factory does by itself. Assist: people start every session. Build: claimable items are dispatched to the implementer agents in rank order up to maxConcurrentSessions. Autopilot: as Build, and Lictory merges an agent's code pull request when the required checks (${autopilotRequirements.join(", ")}) pass, attributed to this policy and you. Recorded in the audit log; lowering autonomy releases nothing (claims in flight continue or can be released).`,
  kind: "command",
  surfaces: webOnly,
  decision: true,
  humanOnly: {
    reason: "autonomy",
    where: "Project settings → Autonomy",
    alternative: "getAutonomyPolicy",
  },
  input: z.object({
    organizationId,
    projectId: id,
    policy: autonomyPolicyInputSchema,
    expectedVersion: z.number().int().min(0).optional(),
    mutationId,
  }),
  run: (ctx, input) => setAutonomyPolicy(ctx.db, actor(ctx), input),
});

const getDefinitionOfDone = defineCapability({
  name: "getDefinitionOfDone",
  title: "Get Definition of Done",
  description:
    "A project's Definition of Done (what must be true before work is Done; Lictory's defaults when never set), and with `workItemId` that item's evaluation: each check, whether it passes and why, from code evidence and people's sign-offs. Agents read it to know what finishing means; they cannot pass it by reporting.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, projectId: id, workItemId: id.optional() }),
  run: (ctx, input) => definitionOfDoneOf(ctx.db, ctx.principal.userId, input),
});

const setDefinitionOfDoneCapability = defineCapability({
  name: "setDefinitionOfDone",
  title: "Set Definition of Done",
  description:
    "Project administrators: the checks that move work to Done by evidence (a linked code pull request merged, required CI checks passed, a reviewer approved the head commit, people verified the acceptance criteria). An empty list means people always move work to Done themselves. Items in progress are evaluated again, and those that now pass move to Done.",
  kind: "command",
  surfaces: webOnly,
  decision: true,
  humanOnly: {
    reason: "autonomy",
    where: "Project settings → Definition of Done",
    alternative: "getDefinitionOfDone",
  },
  input: z.object({
    organizationId,
    projectId: id,
    checks: z.array(doneCheckDefinitionSchema).max(12),
    expectedVersion: z.number().int().min(0).optional(),
    mutationId,
  }),
  run: (ctx, input) => setDefinitionOfDone(ctx.db, actor(ctx), input),
});

const signOffDoneCheckCapability = defineCapability({
  name: "signOffDoneCheck",
  title: "Sign off acceptance",
  description:
    "Confirm (signedOff: true) or withdraw that the acceptance criteria of a work item in progress were verified, for its accepted revision. Members of the check's disciplines (any discipline holder when it names none).",
  kind: "command",
  surfaces: webOnly,
  decision: true,
  humanOnly: {
    reason: "autonomy",
    where: "The work item → Definition of Done",
    alternative: "getDefinitionOfDone",
  },
  input: z.object({
    organizationId,
    workItemId: id,
    checkId: id,
    signedOff: z.boolean(),
    mutationId,
  }),
  run: (ctx, input) => signOffDoneCheck(ctx.db, actor(ctx), input),
});

const overrideDoneCheckCapability = defineCapability({
  name: "overrideDoneCheck",
  title: "Override a Definition of Done check",
  description:
    "Pass a failing Definition of Done check of one work item by hand, for its accepted revision, with the reason (overridden: true), or withdraw the override. People who change properties in the project. Recorded in the item's history.",
  kind: "command",
  surfaces: webOnly,
  decision: true,
  humanOnly: {
    reason: "autonomy",
    where: "The work item → Definition of Done",
    alternative: "getDefinitionOfDone",
  },
  input: z.object({
    organizationId,
    workItemId: id,
    checkId: id,
    overridden: z.boolean(),
    reason: z.string().trim().max(1000).optional(),
    mutationId,
  }),
  run: (ctx, input) => overrideDoneCheck(ctx.db, actor(ctx), input),
});

export const claimCapabilities: AnyCapability[] = [
  listClaimableItems,
  listClaims,
  claimItemCapability,
  renewClaimCapability,
  releaseClaimCapability,
  reportProgressCapability,
  askQuestionCapability,
  retryDispatchCapability,
  getDispatchState,
  getAutonomyPolicy,
  setAutonomyPolicyCapability,
  getDefinitionOfDone,
  setDefinitionOfDoneCapability,
  signOffDoneCheckCapability,
  overrideDoneCheckCapability,
] as AnyCapability[];
