import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { EntityOf } from "@lictory/core/contracts/protocol";

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
  // The revision number a run read for this item, for its provenance.
  revisionOf: (run: Run) => number | undefined;
};

export type DockItem = {
  id: string;
  key: string;
  title: string;
  // Only specifications are assessed; plain work has no review.
  review: DockReview | null;
};

// Text selected in an item's specification, or in a page of Lictory Spaces
// (with the block holding its start).
export type DockSelection = { quote: string; section: string } & (
  | { itemId: string; pageId?: undefined; blockId?: undefined }
  | { pageId: string; blockId: string | null; itemId?: undefined }
);

// The page of Lictory Spaces on screen: the exact version being read
// (`commitId`; absent while editing a live draft, which is never history),
// the line when it is not main, and the work items its content references
// that the person can see.
export type DockPage = {
  spaceId: string;
  pageId: string;
  title: string;
  branchId?: string;
  commitId?: string;
  items: { id: string; key: string }[];
};

// Something on the page asked the dock to open, optionally with a prompt to
// send or a review to show.
export type DockRequest = {
  id: number;
  prompt?: string;
  send?: boolean;
  assess?: boolean;
  // Closes the sheet when it is already open (a launcher pressed again).
  toggle?: boolean;
  // Opens on the item's AI assessment.
  showReview?: boolean;
};

type DockState = {
  item: DockItem | null;
  page: DockPage | null;
  selection: DockSelection | null;
  request: DockRequest | null;
  // Whether the side sheet is open. Launchers in the page chrome read it.
  expanded: boolean;
};

export class DockStore {
  private state: DockState = {
    item: null,
    page: null,
    selection: null,
    request: null,
    expanded: false,
  };
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
  setPage(page: DockPage) {
    this.set({ page });
  }
  clearPage(pageId: string) {
    if (this.state.page?.pageId !== pageId) return;
    this.set({
      page: null,
      selection:
        this.state.selection?.pageId === pageId ? null : this.state.selection,
    });
  }
  setSelection(selection: DockSelection | null) {
    const current = this.state.selection;
    const same =
      current === selection ||
      (current?.quote === selection?.quote &&
        current?.itemId === selection?.itemId &&
        current?.pageId === selection?.pageId &&
        current?.blockId === selection?.blockId);
    if (same) return;
    this.set({ selection });
  }
  open(request: Omit<DockRequest, "id"> = {}) {
    this.set({ request: { ...request, id: this.next++ } });
  }
  setExpanded(expanded: boolean) {
    if (this.state.expanded !== expanded) this.set({ expanded });
  }
  consume(id: number) {
    if (this.state.request?.id === id) this.set({ request: null });
  }
}

// The item review the dock and its launchers show: the newest run, and the
// newest completed one (it stays visible while a new run is queued).
export function reviewState(review: DockReview) {
  const [latest] = review.runs;
  const completed = review.runs.find((r) => r.status === "completed");
  const active =
    !!latest && (latest.status === "queued" || latest.status === "running");
  const failed = latest?.status === "failed" ? latest : undefined;
  return { latest, completed, active, failed };
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

const empty: DockState = {
  item: null,
  page: null,
  selection: null,
  request: null,
  expanded: false,
};
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

// Publishes the page of Lictory Spaces on screen while mounted.
export function usePublishDockPage(page: DockPage | null) {
  const store = useDock();
  useEffect(() => {
    if (store && page) store.setPage(page);
  }, [store, page]);
  const id = page?.pageId;
  useEffect(() => {
    if (!store || !id) return;
    return () => store.clearPage(id);
  }, [store, id]);
}
