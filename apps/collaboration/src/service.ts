import { Hocuspocus, type onAuthenticatePayload } from "@hocuspocus/server";
import type { Database } from "@lictory/core/domain/service";
import { listenForSignals } from "@lictory/core/jobs/listener";
import { draftCollaboration } from "@lictory/core/spaces/collaboration";
import {
  canReadDraft,
  canWriteDraft,
  resolveDraftDocument,
} from "@lictory/core/spaces/draft-access";
import type { DraftAuthor } from "@lictory/core/spaces/drafts";
import {
  SPACES_ACCESS_CHANNEL,
  spacesAccessSignalSchema,
} from "@lictory/core/spaces/signals";
import { listenCollaboration } from "@lictory/core/spaces/transport";
import { describeError, type Log } from "@lictory/collaboration/log";
import { claimOwnership } from "@lictory/collaboration/owner";

// The collaboration service: Hocuspocus for live drafts of Lictory Spaces
// (docs/internals/spaces.md#synchronization-and-the-collaboration-service).
// It authenticates every connection with the Better Auth session cookie of
// the WebSocket upgrade, stores each change before anyone sees it, and
// rechecks open connections when access changes (signals after commit) and
// every 30 seconds.

type SessionLookup = (
  headers: Headers,
) => Promise<{ session: { id: string; userId: string } } | null>;

// The person and session behind a connection: the Better Auth session cookie
// sent with the upgrade request (same origin, so the browser sends it).
// Never a token from the URL or the provider's token field, which browsers
// leave empty and which is ignored.
export function sessionAuthenticator(getSession: SessionLookup) {
  return async ({
    requestHeaders,
  }: Pick<
    onAuthenticatePayload,
    "requestHeaders"
  >): Promise<DraftAuthor | null> => {
    if (!requestHeaders.get("cookie")) return null;
    const found = await getSession(requestHeaders).catch(() => null);
    return found
      ? { userId: found.session.userId, sessionId: found.session.id }
      : null;
  };
}

export type CollaborationOptions = {
  db: Database;
  // Direct (never pooled) connection for LISTEN and the owner lock.
  directUrl: string;
  port: number;
  host: string;
  // The platform's public origin; upgrades from any other Origin are refused.
  allowedOrigin: string | undefined;
  authenticate: (
    request: Pick<onAuthenticatePayload, "requestHeaders">,
  ) => Promise<DraftAuthor | null>;
  log: Log;
  // Called when the owner lock is lost while serving: stop at once.
  onOwnershipLost: (error: unknown) => void;
  ownerWaitMs?: number;
  revalidateEveryMs?: number;
};

export async function startCollaboration(options: CollaborationOptions) {
  const { log } = options;
  const ownership = await claimOwnership(options.directUrl, {
    waitMs: options.ownerWaitMs ?? 15_000,
    onWaiting: () =>
      log("warn", "collaboration.owner_waiting", {
        reason:
          "Another collaboration service holds the owner lock; waiting for it to stop.",
      }),
    onLost: (error) => {
      log("error", "collaboration.owner_lost", { ...describeError(error) });
      options.onOwnershipLost(error);
    },
  });

  const collaboration = draftCollaboration({
    db: options.db,
    authenticate: options.authenticate,
    resolve: (name) => resolveDraftDocument(options.db, name),
    canRead: canReadDraft,
    canEdit: canWriteDraft,
    revalidateEveryMs: options.revalidateEveryMs,
  });
  const hocuspocus = new Hocuspocus({
    quiet: true,
    extensions: [collaboration.extension],
  });

  const recheck = (work: Promise<void>, what: string) =>
    work.catch((error: unknown) =>
      log("warn", "collaboration.revalidate_failed", {
        what,
        ...describeError(error),
      }),
    );
  const listener = listenForSignals(options.directUrl, SPACES_ACCESS_CHANNEL, {
    onSignal(payload) {
      let signal;
      try {
        signal = spacesAccessSignalSchema.parse(JSON.parse(payload));
      } catch {
        return;
      }
      for (const userId of signal.userIds)
        void recheck(collaboration.revalidate(hocuspocus, userId), "user");
      if (signal.draftIds.length)
        void recheck(
          collaboration.revalidateDrafts(hocuspocus, signal.draftIds),
          "draft",
        );
    },
    onListening(reconnected) {
      log("info", "collaboration.listening", { reconnected });
      // Signals sent while the connection was down are gone.
      if (reconnected)
        void recheck(collaboration.revalidate(hocuspocus), "all");
    },
    onLost: (error) =>
      log("warn", "collaboration.listen_lost", { ...describeError(error) }),
  });

  let draining = false;
  const transport = await listenCollaboration({
    hocuspocus,
    port: options.port,
    host: options.host,
    allowedOrigin: options.allowedOrigin,
    ready: () => !draining,
  }).catch(async (error: unknown) => {
    await listener.close();
    await ownership.release();
    throw error;
  });

  return {
    port: transport.port,
    hocuspocus,
    listening: () => listener.listening(),
    connections: () => hocuspocus.getConnectionsCount(),
    // Graceful stop: refuse new connections, close open ones (clients keep
    // unsaved changes and resend them on reconnect), wait for pending saves
    // (bounded), then drop LISTEN and the owner lock.
    async stop() {
      draining = true;
      await transport.close();
      await listener.close();
      await ownership.release();
    },
  };
}
