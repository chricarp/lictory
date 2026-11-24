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
  kind: "started" | "status" | "approval_requested" | "approval_answered";
  status: SessionStatus;
  // For approval events.
  approvalId?: string;
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
    projectId: string | null;
    workItemId: string | null;
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
