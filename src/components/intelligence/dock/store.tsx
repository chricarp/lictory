"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EntityOf } from "~/sync/shared/protocol";

// What the Intelligence dock knows about the page beneath it. Pages publish
// the open work item and the text selected in it; the dock reads them. It is
// an external store so publishing never re-renders the shell.

type Run = EntityOf<"aiRun">;

export type DockReview = {
  // Newest item review first.
  runs: Run[];
  // Why the person cannot start one now, or null.
  blocked: string | null;
  request: () => Promise<void>;
  // Opens a review's findings in the item.
  open: (runId: string) => void;
  // The review the person is reading in the item, if any.
  viewing: string | null;
};

export type DockItem = {
  id: string;
  key: string;
  title: string;
  // Only specifications are assessed; plain work has no review.
  review: DockReview | null;
};

export type DockSelection = {
  itemId: string;
  quote: string;
  section: string;
};

// Something on the page asked the dock to open, optionally with a prompt to
// send or a review to show.
export type DockRequest = {
  id: number;
  prompt?: string;
  send?: boolean;
  assess?: boolean;
};

type DockState = {
  item: DockItem | null;
  selection: DockSelection | null;
  request: DockRequest | null;
};

export class DockStore {
  private state: DockState = { item: null, selection: null, request: null };
  private listeners = new Set<() => void>();
  private next = 1;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  get = () => this.state;
  private set(patch: Partial<DockState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  setItem(item: DockItem) {
    this.set({ item });
  }
  clearItem(id: string) {
    if (this.state.item?.id !== id) return;
    this.set({
      item: null,
      selection:
        this.state.selection?.itemId === id ? null : this.state.selection,
    });
  }
  setSelection(selection: DockSelection | null) {
    const current = this.state.selection;
    const same =
      current === selection ||
      (current?.quote === selection?.quote &&
        current?.itemId === selection?.itemId);
    if (same) return;
    this.set({ selection });
  }
  open(request: Omit<DockRequest, "id"> = {}) {
    this.set({ request: { ...request, id: this.next++ } });
  }
  consume(id: number) {
    if (this.state.request?.id === id) this.set({ request: null });
  }
}

const DockContext = createContext<DockStore | null>(null);

export function DockProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new DockStore());
  return <DockContext.Provider value={store}>{children}</DockContext.Provider>;
}

// Null outside the workspace shell; callers treat the dock as absent.
export function useDock() {
  return useContext(DockContext);
}

const empty: DockState = { item: null, selection: null, request: null };
const noop = () => () => undefined;

export function useDockState() {
  const store = useDock();
  return useSyncExternalStore(
    store?.subscribe ?? noop,
    store?.get ?? (() => empty),
    () => empty,
  );
}

// Publishes the open work item while the calling component is mounted.
export function usePublishDockItem(item: DockItem | null) {
  const store = useDock();
  useEffect(() => {
    if (store && item) store.setItem(item);
  }, [store, item]);
  const id = item?.id;
  useEffect(() => {
    if (!store || !id) return;
    return () => store.clearItem(id);
  }, [store, id]);
}
