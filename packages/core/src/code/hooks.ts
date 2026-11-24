import type { Tx } from "@lictory/core/domain/service";

// Where Code tells the Factory about agent sessions' pull requests
// (docs/internals/code-hosts.md#pull-requests-from-agent-sessions). The
// Factory owns sessions and their threads, so Code never writes them: the
// code loop (code/loop.ts) installs these at process start. The defaults do
// nothing, so Code works without the Factory.

export type SessionPullRequestEvent = {
  organizationId: string;
  sessionId: string;
  pullRequestId: string;
  number: number;
  title: string;
  url: string;
  workItemId: string | null;
};

export type CodeSessionHooks = {
  // Inside the outbox's transaction, which holds the organization lock
  // exclusively (so no Factory writer runs): the session records its pull
  // request.
  pullRequestOpened(tx: Tx, event: SessionPullRequestEvent): Promise<void>;
  // After that transaction committed: the session's thread shows it.
  afterPullRequestOpened(event: SessionPullRequestEvent): Promise<void>;
  // After commit, whenever pull requests were opened or changed (a new
  // head): the reviewer agent's session can start.
  pullRequestsChanged(
    organizationId: string,
    pullRequestIds: string[],
  ): Promise<void>;
};

const none: CodeSessionHooks = {
  pullRequestOpened: () => Promise.resolve(),
  afterPullRequestOpened: () => Promise.resolve(),
  pullRequestsChanged: () => Promise.resolve(),
};
let installed: CodeSessionHooks = none;

export function setCodeSessionHooks(hooks: CodeSessionHooks | null) {
  installed = hooks ?? none;
}

export const codeSessionHooks = () => installed;

// After-commit hooks never fail the work that committed.
export async function afterCommit(name: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: `code.${name}_failed`,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
