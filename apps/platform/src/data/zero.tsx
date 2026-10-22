import { ZeroProvider, useZero } from "@rocicorp/zero/react";
import type { Zero } from "@rocicorp/zero";
import {
  createContext,
  useContext,
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
  current?.connection.connect();
}

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
  const cacheURL = `${window.location.origin}/zero`;
  const data = useMemo(() => ({ pending }), [pending]);
  return (
    <ZeroProvider
      key={userId}
      userID={userId}
      context={{ userID: userId }}
      cacheURL={cacheURL}
      storageKey="lictory"
      schema={schema}
      mutators={mutators}
      init={(zero) => {
        current = zero as unknown as Zero;
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
        zero.mutate(
          mutators.workspace.apply(mutation),
        ) as unknown as MutationCall,
    [zero],
  );
}
