import type { SessionStatus } from "@lictory/core/factory/entities";

// Boundaries other modules plug into. Factory owns sessions; Channels owns
// threads and Code owns repositories and their credentials, so neither is
// reached directly: each provides an implementation at startup and the
// defaults keep the Factory working without them.

// A session changed in a way its steering thread should show (a card
// posted when it starts, its status, an approval request). Called after
// the change committed, never inside a transaction; failures are logged and
// never undo the change.
export type SessionThreadEvent = {
  organizationId: string;
  sessionId: string;
  channelId: string | null;
  threadRootMessageId: string | null;
  kind:
    | "started"
    | "status"
    | "approval_requested"
    | "approval_answered"
    // The agent answered a person's steering message (`eventSequence`).
    | "agent_message"
    // The code pull request the session's branch became was opened.
    | "pull_request";
  status: SessionStatus;
  // For approval events.
  approvalId?: string;
  // For agent messages: the event in the session's log.
  eventSequence?: number;
  // For pull requests: what the thread says.
  pullRequest?: { number: number; title: string; url: string };
};
export type SessionThreadPublisher = {
  publish(event: SessionThreadEvent): Promise<void>;
};

const noThreads: SessionThreadPublisher = { publish: async () => undefined };
let threadPublisher: SessionThreadPublisher = noThreads;

export function setSessionThreadPublisher(
  publisher: SessionThreadPublisher | null,
) {
  threadPublisher = publisher ?? noThreads;
}

export async function publishSessionEvent(event: SessionThreadEvent) {
  try {
    await threadPublisher.publish(event);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "factory.thread_publish_failed",
        sessionId: event.sessionId,
        kind: event.kind,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

// Where a session's code comes from. The default uses the repository URL
// stated on the session and brokers no credentials (public repositories,
// or a runner with its own git credentials). The Code module replaces it
// with short-lived, repository-scoped code host tokens.
export type SessionWorkspace = {
  url: string;
  baseBranch: string | null;
  branch: string;
  auth: { username: string; password: string; expiresAt: string | null } | null;
};
export type SessionWorkspaceResolver = {
  resolve(session: {
    id: string;
    organizationId: string;
    agentId: string;
    // The agent's owner, whose access the session has.
    ownerId: string;
    projectId: string | null;
    workItemId: string | null;
    // The Code module's repository the session names, if any.
    repositoryId: string | null;
    repositoryUrl: string | null;
    baseBranch: string | null;
    branch: string | null;
  }): Promise<SessionWorkspace | null>;
};

const explicitRepository: SessionWorkspaceResolver = {
  resolve: async (session) =>
    session.repositoryUrl && session.branch
      ? {
          url: session.repositoryUrl,
          baseBranch: session.baseBranch,
          branch: session.branch,
          auth: null,
        }
      : null,
};
let workspaceResolver: SessionWorkspaceResolver = explicitRepository;

export function setSessionWorkspaceResolver(
  resolver: SessionWorkspaceResolver | null,
) {
  workspaceResolver = resolver ?? explicitRepository;
}

export function resolveSessionWorkspace(
  session: Parameters<SessionWorkspaceResolver["resolve"]>[0],
) {
  return workspaceResolver.resolve(session);
}

// Runners renew their sessions' leases with every heartbeat. Called after
// the heartbeat committed, with the sessions whose lease was renewed, so the
// claim a session works under stays held while the session is alive. No-op
// by default; failures are logged.
export type SessionLeaseListener = {
  renewed(organizationId: string, sessionIds: string[]): Promise<void>;
};
const noLeaseListener: SessionLeaseListener = {
  renewed: async () => undefined,
};
let leaseListener: SessionLeaseListener = noLeaseListener;

export function setSessionLeaseListener(listener: SessionLeaseListener | null) {
  leaseListener = listener ?? noLeaseListener;
}

export async function sessionLeasesRenewed(
  organizationId: string,
  sessionIds: string[],
) {
  if (!sessionIds.length) return;
  try {
    await leaseListener.renewed(organizationId, sessionIds);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "factory.lease_listener_failed",
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

// A session completed after its runner pushed its branch. Called after the
// completion committed, never inside a transaction; failures are logged.
// The Code module opens the code pull request the branch becomes. No-op by
// default (a session without the Code module only reports its branch).
export type SessionCompletion = {
  organizationId: string;
  sessionId: string;
  agentId: string;
  ownerId: string;
  agentName: string;
  agentHandle: string;
  requestedById: string;
  projectId: string | null;
  workItemId: string | null;
  repositoryId: string | null;
  repositoryUrl: string | null;
  baseBranch: string | null;
  branch: string;
  title: string;
  summary: string | null;
  attempt: number;
};
export type SessionCompletionListener = {
  pushed(completion: SessionCompletion): Promise<void>;
};
const noCompletionListener: SessionCompletionListener = {
  pushed: async () => undefined,
};
let completionListener: SessionCompletionListener = noCompletionListener;

export function setSessionCompletionListener(
  listener: SessionCompletionListener | null,
) {
  completionListener = listener ?? noCompletionListener;
}

export async function sessionPushed(completion: SessionCompletion) {
  try {
    await completionListener.pushed(completion);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "factory.completion_listener_failed",
        sessionId: completion.sessionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
