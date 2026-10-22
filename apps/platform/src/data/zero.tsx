import { ZeroProvider, useZero } from "@rocicorp/zero/react";
import type { Zero } from "@rocicorp/zero";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import "@lictory/zero/context";
import { mutators } from "@lictory/zero/mutators";
import { schema } from "@lictory/zero/schema";
import type { Mutation } from "@lictory/core/contracts/protocol";
import {
  PendingTracker,
  type MutationCall,
} from "@lictory/platform/data/mutations";

// One Zero client per signed-in person: its IndexedDB store is keyed by the
// user ID and "lictory", so accounts never read each other's cache. Switching
// accounts remounts the provider (a new instance); signing out deletes the
// signed-out person's local databases.

let current: Zero | undefined;

export async function deleteLocalWorkspaceData() {
  const zero = current;
  current = undefined;
  if (!zero) return;
  try {
    await zero.delete();
  } catch {
    await zero.close().catch(() => undefined);
  }
}

// Reconnect after the session was refreshed (needs-auth) or an error.
export function reconnectWorkspace() {
  void current?.connection.connect();
}

const UNSTORED_WINDOW_MS = 3000;

type UserData = { pending: PendingTracker };
const UserDataContext = createContext<UserData | null>(null);

export function WorkspaceDataProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [pending] = useState(() => new PendingTracker());
  // Zero writes queued changes to this device about a second after the tab
  // goes idle. Leaving within that window, before the server confirmed a
  // change, could lose it, so the browser asks first. Older unconfirmed
  // changes are already stored and replay on the next visit.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      const recent = Date.now() - UNSTORED_WINDOW_MS;
      if (pending.snapshot().some((p) => p.enqueuedAt > recent))
        event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);
  const cacheURL = `${window.location.origin}/zero`;
  const data = useMemo(() => ({ pending }), [pending]);
  return (
    <ZeroProvider
      key={userId}
      userID={userId}
      context={{ userID: userId }}
      cacheURL={cacheURL}
      storageKey="lictory"
      // Temporary network loss keeps edits queued (as before the move to
      // Zero) for up to ten minutes; after that Zero refuses writes and the
      // workspace turns read-only until it reconnects. Authored text from a
      // refused write stays in the recovery store.
      disconnectTimeoutMs={10 * 60_000}
      schema={schema}
      mutators={mutators}
      init={(zero) => {
        current = zero;
      }}
    >
      <UserDataContext.Provider value={data}>
        {children}
      </UserDataContext.Provider>
    </ZeroProvider>
  );
}

export function usePendingTracker() {
  const value = useContext(UserDataContext);
  if (!value)
    throw new Error("usePendingTracker requires WorkspaceDataProvider.");
  return value.pending;
}

// Sends one workspace command through the `workspace.apply` mutator.
export function useApplyMutation() {
  const zero = useZero();
  return useMemo(
    () =>
      (mutation: Mutation): MutationCall =>
        zero.mutate(mutators.workspace.apply(mutation)),
    [zero],
  );
}
