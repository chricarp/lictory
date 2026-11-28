import type { Tx } from "@lictory/core/domain/service";

// The factory loop's boundaries (docs/internals/claims.md#ports). Claims own
// the loop's rules; agents, runners and sessions belong to the Factory
// module and code hosts to the Code module, which implement these ports and
// install them at startup with `configureClaimPorts`. The defaults keep
// Lictory working with neither: nothing is dispatched, code checks read as
// not satisfied with the reason, and nothing is merged.
//
// Ports called with a transaction run inside the organization lock: they
// read and write Lictory's own tables only (queue work for later) and never
// call a network service.

// An agent the dispatcher can start sessions for, as the Factory module
// knows it.
export type FactoryAgent = {
  id: string;
  name: string;
  // The accountable person the agent acts for.
  ownerId: string;
  // Projects the agent may work in; null when its scope allows every one.
  projectIds: string[] | null;
  // Runner agents can be dispatched; external MCP agents claim by themselves.
  dispatchable: boolean;
};

export type AgentDirectory = {
  agents(tx: Tx, organizationId: string): Promise<FactoryAgent[]>;
};

// What the dispatcher asks the Factory module to start. The claim is already
// reserved (state `starting`); the session is linked to it.
export type SessionLaunch = {
  organizationId: string;
  projectId: string;
  workItemId: string;
  itemKey: string;
  claimId: string;
  agentId: string;
  ownerId: string;
  // Stable per claim: launching the same claim twice must start one session.
  idempotencyKey: string;
};
export type SessionLaunchResult =
  | { started: true; sessionId: string }
  | { started: false; reason: string; retryable: boolean };

// Called outside any transaction: the Factory module may queue a runner
// assignment in its own transaction or refuse.
export type AgentSessionLauncher = {
  launch(request: SessionLaunch): Promise<SessionLaunchResult>;
};

export type SessionResumeEvent =
  | {
      // The agent asked people a question under its claim (askQuestion):
      // the session's thread and the project's reporting channel can
      // announce it.
      kind: "question_asked";
      organizationId: string;
      claimId: string;
      agentSessionId: string | null;
      projectId: string;
      workItemId: string;
      itemKey: string;
      // The anchored discussion and the item it is on.
      threadId: string;
      questionItemId: string;
      questionItemKey: string;
      question: string;
      agentName: string;
      ownerId: string;
    }
  | {
      kind: "question_resolved";
      organizationId: string;
      claimId: string;
      agentSessionId: string | null;
      workItemId: string;
      threadId: string;
      resolvedById: string;
      // Every question of the claim is resolved; it is active again.
      resumed: boolean;
    }
  | {
      kind: "claim_ended";
      organizationId: string;
      claimId: string;
      agentSessionId: string | null;
      workItemId: string;
      state: "released" | "completed";
      reason: string;
    };

// Tells the session behind a claim what people decided. Inside the
// transaction that asked or resolved the question or ended the claim.
export type SessionResumer = {
  resume(tx: Tx, event: SessionResumeEvent): Promise<void>;
};

// Code evidence about one work item, read from the Code module's mirror of
// the code host (never from the host itself).
export type CodePullRequestEvidence = {
  id: string;
  title: string;
  url: string | null;
  state: "open" | "merged" | "closed";
  headSha: string | null;
  // Required checks on the head commit. `passed` only when every required
  // check succeeded; `pending` lists checks that have not finished.
  // `required` is 0 when the host reported none for the commit (or marked
  // none of the `reported` ones required): no evidence that CI passed.
  checks: {
    required: number;
    failing: string[];
    pending: string[];
    reported?: number;
  };
  // Approving reviews of the head commit: an agent (by agent id) or a
  // person (by user id), recorded in Lictory; or an approval on the host
  // (its `login`, with the person who set it as their login, if any).
  approvals: {
    agentId: string | null;
    userId: string | null;
    login?: string | null;
  }[];
  // Whether the code host would merge it now (mergeable, no conflicts,
  // branch protection met), as last reported.
  mergeable: boolean | null;
  // Who did the work, for claimability ("#12 by Ada"). Optional: an
  // implementation that does not know leaves them out.
  // The pull request's number on its host.
  number?: number;
  // Opened from an agent session of this factory (Lictory's provenance,
  // never the host's author login): agent work the factory may retry.
  openedByAgent?: boolean;
  // The person who opened it: through Lictory, or the member who set the
  // host author's login as theirs; else only the host login is known.
  authorId?: string | null;
  authorLogin?: string | null;
};
export type CodeEvidence =
  | { connected: false; explanation: string }
  | { connected: true; pullRequests: CodePullRequestEvidence[] };

export type DeliveryEvidenceSource = {
  evidence(
    tx: Tx,
    organizationId: string,
    workItemIds: string[],
  ): Promise<Map<string, CodeEvidence>>;
};

export type MergeRequest = {
  organizationId: string;
  projectId: string;
  workItemId: string;
  pullRequestId: string;
  headSha: string;
  // Attribution: the autonomy policy and the administrator who set it.
  policyVersion: number;
  authorizedById: string;
  idempotencyKey: string;
};
export type MergeRequestResult =
  { requested: true } | { requested: false; reason: string };

// Queues a merge on the code host (Code module), in the caller's
// transaction; the Code worker performs it.
export type CodeMergeExecutor = {
  requestMerge(tx: Tx, request: MergeRequest): Promise<MergeRequestResult>;
};

export type ClaimPorts = {
  agents: AgentDirectory;
  launcher: AgentSessionLauncher;
  resumer: SessionResumer;
  evidence: DeliveryEvidenceSource;
  merges: CodeMergeExecutor;
};

const noCodeHost =
  "No code host is connected. An organization administrator connects GitHub, GitLab or Bitbucket under Code.";

export const defaultClaimPorts: ClaimPorts = {
  agents: { agents: () => Promise.resolve([]) },
  launcher: {
    launch: () =>
      Promise.resolve({
        started: false,
        reason:
          "No runner agents are configured. Add a runner and an agent under Factory before choosing Build or Autopilot.",
        retryable: true,
      }),
  },
  resumer: { resume: () => Promise.resolve() },
  evidence: {
    evidence: (_tx, _organizationId, workItemIds) =>
      Promise.resolve(
        new Map(
          workItemIds.map((id) => [
            id,
            { connected: false, explanation: noCodeHost } as const,
          ]),
        ),
      ),
  },
  merges: {
    requestMerge: () =>
      Promise.resolve({
        requested: false,
        reason:
          "No code host is connected, so Lictory cannot merge pull requests.",
      }),
  },
};

let installed: ClaimPorts = defaultClaimPorts;

// Installs implementations (at process start, or in tests). Ports left out
// keep their current implementation.
export function configureClaimPorts(ports: Partial<ClaimPorts>) {
  installed = { ...installed, ...ports };
}

// Back to the defaults (tests).
export function resetClaimPorts() {
  installed = defaultClaimPorts;
}

export const claimPorts = () => installed;
