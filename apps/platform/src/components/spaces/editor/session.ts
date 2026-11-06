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
import { ownClock } from "@lictory/platform/components/spaces/editor/recovery";

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
  // When the save state last changed (see `shownSaveState`).
  save: SaveTiming;
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

// Sessions still flushing after they were closed, by document name. The
// shared socket registers providers by document name, so a new session for
// the same draft must not attach while an old one is still registered:
// attaching would throw, and the old one's later detach would remove the new
// registration and silently stop its sync.
const retiringByName = new Map<string, DraftSession>();

export class DraftSession {
  readonly doc = new Y.Doc();
  readonly provider: HocuspocusProvider;
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private sequenceWaiters = new Set<(sequence: number) => void>();
  private timer: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private retiring = false;
  private keep: ((doc: Y.Doc, storedClock: number) => void) | null = null;
  private kept = false;
  // The clock of this tab's own edits when the service last had stored
  // all of them: anything this tab typed from it on is not stored yet.
  // (The provider's own counter also counts a reconnect that the service
  // refused, so it cannot tell unstored text from a refused handshake.)
  private storedClock = 0;

  constructor(
    readonly documentName: string,
    user: { userId: string; name: string; color: string },
  ) {
    // A session closed moments ago for this draft gives up its flush now:
    // its unstored text goes to `keep` and its registration is released.
    retiringByName.get(documentName)?.finishRetiring();
    const websocketProvider = sharedSocket();
    this.snapshot = withSaveTiming(null, {
      status: websocketProvider.status,
      everSynced: false,
      unsynced: false,
      storedSequence: null,
      readOnly: false,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      unavailable: false,
      closed: null,
      peers: [],
    });
    this.provider = new HocuspocusProvider({
      websocketProvider,
      name: documentName,
      document: this.doc,
      // The session cookie authenticates; the service never reads a token.
      token: "",
      onStatus: ({ status }) => this.set({ status }),
      onSynced: () => this.set({ everSynced: true, unavailable: false }),
      onUnsyncedChanges: () => {
        const unsynced = this.provider.hasUnsyncedChanges;
        if (!unsynced) this.storedClock = ownClock(this.doc);
        this.set({ unsynced });
      },
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
    this.snapshot = withSaveTiming(this.snapshot.save, {
      ...this.snapshot,
      ...patch,
    });
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

  // Whether this tab typed something the service has not stored.
  hasUnstoredEdits() {
    return ownClock(this.doc) > this.storedClock;
  }

  // Closes the session without dropping unstored edits: while the
  // connection is still open they get a short, bounded chance to be stored
  // (a replaced epoch's service refuses them, which is fine); whatever is
  // still unstored is handed to `keep` with the clock it starts at, before
  // the provider and document are destroyed. Closes synchronously when
  // there is nothing to keep.
  async retire(
    keep: (doc: Y.Doc, storedClock: number) => void,
    flushMs = 2000,
  ) {
    if (this.destroyed || this.retiring) return;
    this.retiring = true;
    this.keep = keep;
    retiringByName.set(this.documentName, this);
    try {
      if (!this.hasUnstoredEdits()) return;
      if (
        this.snapshot.status === WebSocketStatus.Connected &&
        !this.snapshot.closed
      )
        await this.saved(flushMs).catch(() => undefined);
    } finally {
      this.finishRetiring();
    }
  }

  // Ends a retirement at once: keeps what is still unstored (once), then
  // destroys the provider and document.
  private finishRetiring() {
    if (this.destroyed) return;
    try {
      if (this.keep && !this.kept && this.hasUnstoredEdits()) {
        this.kept = true;
        this.keep(this.doc, this.storedClock);
      }
    } catch {
      // Keeping is best effort; closing must still happen.
    } finally {
      if (retiringByName.get(this.documentName) === this)
        retiringByName.delete(this.documentName);
      this.destroy();
    }
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
export function saveStateOf(s: Omit<SessionSnapshot, "save">): SaveState {
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

// What the editor shows can trail the truth above, so that fast saves stay
// quiet: every keystroke is stored within milliseconds, and following each
// one would flash "Saving…" and "Saved" while someone types. The shown
// state never claims more than the truth: "Saved" appears only once every
// edit is stored and has stayed stored for a moment (typing pauses), a save
// still unconfirmed after a second gets a spinner, and problems show at
// once. Only the display waits; persistence, the unload guard and Publish
// read the truth.
export const SLOW_SAVE_MS = 1000;
export const SETTLE_SAVE_MS = 1000;

export type SaveTiming = {
  kind: SaveState["kind"];
  // When the save state became `kind` (`performance.now()`, a monotonic
  // clock: a wall-clock change must not make "Saved" appear early).
  since: number;
  // "Saved" came straight from "Saving…": shown once it holds.
  settling: boolean;
  // A problem (offline, unavailable, closed) came since the last "Saved".
  troubled: boolean;
};

const problems: ReadonlySet<SaveState["kind"]> = new Set([
  "offline",
  "unavailable",
  "closed",
]);

export function nextSaveTiming(
  prev: SaveTiming | null,
  kind: SaveState["kind"],
  now: number,
): SaveTiming {
  if (prev?.kind === kind) return prev;
  const troubled =
    problems.has(kind) || (!!prev && prev.kind !== "saved" && prev.troubled);
  return {
    kind,
    since: now,
    settling: kind === "saved" && prev?.kind === "saving" && !troubled,
    troubled,
  };
}

function withSaveTiming(
  prev: SaveTiming | null,
  s: Omit<SessionSnapshot, "save">,
): SessionSnapshot {
  return {
    ...s,
    save: nextSaveTiming(prev, saveStateOf(s).kind, performance.now()),
  };
}

export type ShownSaveState = {
  state: SaveState;
  // A save is taking long enough to show progress.
  slow: boolean;
  // What assistive technology hears: problems and the recovery from one,
  // never the routine saves of each keystroke.
  announcement: string;
  // When the shown state may change without a new session event.
  wakeAt: number | null;
};

const saving = { kind: "saving", label: "Saving…" } as const;

export function shownSaveState(
  s: SessionSnapshot,
  now: number,
): ShownSaveState {
  const state = saveStateOf(s);
  const { since, settling, troubled } = s.save;
  if (state.kind === "saving") {
    const slowAt = since + SLOW_SAVE_MS;
    const slow = now >= slowAt;
    return { state, slow, announcement: "", wakeAt: slow ? null : slowAt };
  }
  if (state.kind === "saved" && settling && now < since + SETTLE_SAVE_MS)
    return {
      state: saving,
      slow: false,
      announcement: "",
      wakeAt: since + SETTLE_SAVE_MS,
    };
  return {
    state,
    slow: false,
    // Unavailable and closed sessions raise their own alerts.
    announcement:
      state.kind === "offline"
        ? state.label
        : state.kind === "saved" && troubled
          ? "Connection restored. All edits are saved."
          : "",
    wakeAt: null,
  };
}
