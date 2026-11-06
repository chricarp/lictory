import * as Y from "yjs";
import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from "@hocuspocus/provider";
import {
  CLOSE_REASONS,
  DRAFT_SEQUENCE_REQUEST,
  storedSequenceOf,
} from "@lictory/core/spaces/collaboration-protocol";

// One live draft connection: a fresh Y.Doc bound to the collaboration
// service through a socket shared by every draft the tab has open. The
// server's answers become a small snapshot the editor renders (save state,
// stored sequence, who else is here) without re-rendering on each keystroke.

export type ClosedKind = "replaced" | "revoked" | "noAccess" | "signedOut";

export type Peer = {
  clientId: number;
  userId?: string;
  name: string;
  color: string;
};

export type SessionSnapshot = {
  status: WebSocketStatus;
  // The first sync with the service finished (the draft's content is here).
  everSynced: boolean;
  // Local edits the service has not stored yet.
  unsynced: boolean;
  // The last stored sequence the service told us (`expectedSequence`).
  storedSequence: number | null;
  readOnly: boolean;
  online: boolean;
  // The service could not be reached before the first sync.
  unavailable: boolean;
  closed: ClosedKind | null;
  peers: readonly Peer[];
};

const UNAVAILABLE_AFTER_MS = 8000;

let socket: HocuspocusProviderWebsocket | undefined;
let attached = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

// The collaboration service sits behind the platform's own origin.
function collaborationUrl() {
  return `${location.origin.replace(/^http/, "ws")}/collaboration`;
}

function sharedSocket() {
  clearTimeout(idleTimer);
  attached += 1;
  if (!socket)
    socket = new HocuspocusProviderWebsocket({ url: collaborationUrl() });
  else if (socket.status === WebSocketStatus.Disconnected)
    void socket.connect();
  return socket;
}

// The socket stays open briefly after the last draft closes, so moving
// between pages does not reconnect.
function releaseSocket() {
  attached = Math.max(0, attached - 1);
  if (attached > 0) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => socket?.disconnect(), 30_000);
}

export function closedKindOf(reason: string | undefined): ClosedKind | null {
  for (const [kind, text] of Object.entries(CLOSE_REASONS))
    if (reason === text) return kind as ClosedKind;
  return null;
}

export class DraftSession {
  readonly doc = new Y.Doc();
  readonly provider: HocuspocusProvider;
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private sequenceWaiters = new Set<(sequence: number) => void>();
  private timer: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(
    readonly documentName: string,
    user: { userId: string; name: string; color: string },
  ) {
    const websocketProvider = sharedSocket();
    this.snapshot = {
      status: websocketProvider.status,
      everSynced: false,
      unsynced: false,
      storedSequence: null,
      readOnly: false,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      unavailable: false,
      closed: null,
      peers: [],
    };
    this.provider = new HocuspocusProvider({
      websocketProvider,
      name: documentName,
      document: this.doc,
      // The session cookie authenticates; the service never reads a token.
      token: "",
      onStatus: ({ status }) => this.set({ status }),
      onSynced: () => this.set({ everSynced: true, unavailable: false }),
      onUnsyncedChanges: () =>
        this.set({ unsynced: this.provider.hasUnsyncedChanges }),
      onAuthenticated: ({ scope }) =>
        this.set({ readOnly: scope === "readonly" }),
      onAuthenticationFailed: ({ reason }) =>
        this.set({ closed: closedKindOf(reason) ?? "noAccess" }),
      onClose: ({ event }) => {
        const kind = closedKindOf(event.reason);
        if (kind) this.set({ closed: kind });
      },
      onStateless: ({ payload }) => {
        const sequence = storedSequenceOf(payload);
        if (sequence === null) return;
        this.set({
          storedSequence: Math.max(this.snapshot.storedSequence ?? 0, sequence),
        });
        for (const waiter of this.sequenceWaiters) waiter(sequence);
        this.sequenceWaiters.clear();
      },
      onAwarenessChange: ({ states }) =>
        this.set({
          peers: states
            .filter((s) => s.clientId !== this.doc.clientID && s.user)
            .map((s) => {
              const u = s.user as Partial<Peer> & { userId?: string };
              return {
                clientId: s.clientId,
                userId: u.userId,
                name: typeof u.name === "string" ? u.name : "Someone",
                color: typeof u.color === "string" ? u.color : "#6b6e76",
              };
            }),
        }),
    });
    this.provider.setAwarenessField("user", user);
    this.provider.attach();
    this.timer = setTimeout(() => {
      if (!this.snapshot.everSynced && this.snapshot.online)
        this.set({ unavailable: true });
    }, UNAVAILABLE_AFTER_MS);
    window.addEventListener("online", this.onNetwork);
    window.addEventListener("offline", this.onNetwork);
  }

  private onNetwork = () => {
    const online = navigator.onLine;
    this.set({ online });
    if (online && socket?.status === WebSocketStatus.Disconnected)
      void socket.connect();
  };

  private set(patch: Partial<SessionSnapshot>) {
    if (this.destroyed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;

  // Resolves once every local edit is stored (the editor shows "Saved").
  saved(timeoutMs = 15_000) {
    return new Promise<void>((resolve, reject) => {
      const done = () =>
        !this.provider.hasUnsyncedChanges &&
        this.snapshot.status === WebSocketStatus.Connected &&
        this.snapshot.everSynced;
      if (done()) return resolve();
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(
          new Error(
            "Your latest edits are not saved yet. Check your connection and try again.",
          ),
        );
      }, timeoutMs);
      const unsubscribe = this.subscribe(() => {
        if (!done()) return;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      });
    });
  }

  // The latest stored sequence, asked of the service (falls back to the
  // last one it announced when it does not answer in time).
  latestSequence(timeoutMs = 4000) {
    return new Promise<number>((resolve, reject) => {
      const fallback = () => {
        this.sequenceWaiters.delete(answer);
        const known = this.snapshot.storedSequence;
        if (known === null)
          reject(
            new Error(
              "The collaboration service did not confirm what is saved. Try again in a moment.",
            ),
          );
        else resolve(known);
      };
      const timeout = setTimeout(fallback, timeoutMs);
      const answer = (sequence: number) => {
        clearTimeout(timeout);
        resolve(Math.max(sequence, this.snapshot.storedSequence ?? 0));
      };
      this.sequenceWaiters.add(answer);
      this.provider.sendStateless(
        JSON.stringify({ type: DRAFT_SEQUENCE_REQUEST }),
      );
    });
  }

  destroy() {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    window.removeEventListener("online", this.onNetwork);
    window.removeEventListener("offline", this.onNetwork);
    this.destroyed = true;
    this.listeners.clear();
    this.sequenceWaiters.clear();
    this.provider.destroy();
    this.doc.destroy();
    releaseSocket();
  }
}

export type SaveState =
  | { kind: "connecting"; label: string }
  | { kind: "saving"; label: string }
  | { kind: "saved"; label: string }
  | { kind: "offline"; label: string }
  | { kind: "unavailable"; label: string }
  | { kind: "closed"; label: string };

// What the editor says about the draft, in order of what matters most.
// "Saved" means the service stored every edit (it stores before it
// acknowledges).
export function saveStateOf(s: SessionSnapshot): SaveState {
  if (s.closed) return { kind: "closed", label: CLOSE_REASONS[s.closed] };
  if (!s.everSynced)
    return s.unavailable
      ? { kind: "unavailable", label: "Live editing unavailable" }
      : !s.online
        ? { kind: "offline", label: "Offline" }
        : { kind: "connecting", label: "Connecting…" };
  if (!s.online || s.status !== WebSocketStatus.Connected)
    return { kind: "offline", label: "Offline — changes kept on this device" };
  if (s.unsynced) return { kind: "saving", label: "Saving…" };
  return { kind: "saved", label: "Saved" };
}
