import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import {
  parseMarkdownTree,
  placeQuote,
  textModel,
} from "@lictory/core/editor/markdown-text";

// The discussions of a specification as its reader and the panel beside it
// see them: each thread placed in the text on screen (the current
// revision), in document order. A thread keeps the revision it was written
// on; its quote is looked for in what is shown, and when it is not there
// the thread says so and links to that revision instead of attaching to
// other text. Placement is presentation: nothing about a thread changes.

type Thread = EntityOf<"thread">;

export type Placement =
  // The quoted passage is in the text on screen.
  | "here"
  // Not in the text on screen: changed since, or removed with its section.
  | "changed"
  | "removed"
  // About the whole specification (or a section without a quote).
  | "general";

export type LocatedThread = {
  thread: Thread;
  placement: Placement;
  from?: number;
  to?: number;
};

export type Draft = {
  quote?: string;
  section: string;
  occurrence?: number;
} | null;

export function locateThreads(
  content: string,
  threads: readonly Thread[],
): LocatedThread[] {
  const model = textModel(parseMarkdownTree(content));
  const located = threads.map((thread): LocatedThread => {
    const quote = thread.anchor?.quote;
    if (!quote) return { thread, placement: "general" };
    const place = placeQuote(model, {
      quote,
      section: thread.anchor?.section ?? "",
      occurrence: thread.anchor?.occurrence,
    });
    return place.kind === "found"
      ? { thread, placement: "here", from: place.from, to: place.to }
      : { thread, placement: place.kind };
  });
  const rank: Record<Placement, number> = {
    here: 0,
    changed: 1,
    removed: 1,
    general: 2,
  };
  return located.sort(
    (a, b) =>
      rank[a.placement] - rank[b.placement] ||
      (a.from ?? 0) - (b.from ?? 0) ||
      a.thread.createdAt.localeCompare(b.thread.createdAt),
  );
}

type Value = {
  located: LocatedThread[];
  open: number;
  blocking: number;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  // The selected thread, and the one pointed at in the text or the panel.
  active: string | null;
  setActive: (id: string | null) => void;
  hovered: string | null;
  setHovered: (id: string | null) => void;
  // A discussion being written on a selection.
  pending: Draft;
  startDiscussion: (draft: Draft) => void;
  setPending: (draft: Draft) => void;
  // Opens the revision a thread was written on, its quote marked.
  showRevision: (revisionId: string, threadId?: string) => void;
};

const Context = createContext<Value | null>(null);

export function useSpecDiscussions() {
  return useContext(Context);
}

const storageKey = "lictory:item-discussions";
function readChoice(): boolean | undefined {
  try {
    const value = localStorage.getItem(storageKey);
    return value === "open" ? true : value === "closed" ? false : undefined;
  } catch {
    return undefined;
  }
}

// The discussions state of one item. Whether the panel is open is
// remembered in this browser, like pane widths; until someone chooses, it
// opens beside a specification with open discussions when the frame is
// roomy enough for it next to the review rail.
export function useSpecDiscussionsState({
  content,
  threads,
  reviewable,
  roomy,
  onShowRevision,
}: {
  content: string;
  threads: readonly Thread[];
  reviewable: boolean;
  roomy: boolean;
  onShowRevision: (revisionId: string, threadId?: string) => void;
}): Value {
  const located = useMemo(
    () => (reviewable ? locateThreads(content, threads) : []),
    [content, threads, reviewable],
  );
  const openThreads = located.filter((l) => l.thread.status === "open");
  const open = openThreads.length;
  const blocking = openThreads.filter((l) => l.thread.blocking).length;
  const [choice, setChoice] = useState<boolean | undefined>(readChoice);
  const setPanelOpen = useCallback((next: boolean) => {
    setChoice(next);
    try {
      localStorage.setItem(storageKey, next ? "open" : "closed");
    } catch {
      // Private windows: the choice lasts for this page.
    }
  }, []);
  const panelOpen = reviewable && (choice ?? (roomy && open > 0));
  const [active, setActive] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pending, setPending] = useState<Draft>(null);
  const startDiscussion = useCallback(
    (draft: Draft) => {
      setPending(draft);
      setPanelOpen(true);
    },
    [setPanelOpen],
  );
  // A thread that no longer exists is not selected.
  if (active && !threads.some((t) => t.id === active)) setActive(null);
  return useMemo<Value>(
    () => ({
      located,
      open,
      blocking,
      panelOpen,
      setPanelOpen,
      active,
      setActive,
      hovered,
      setHovered,
      pending,
      startDiscussion,
      setPending,
      showRevision: onShowRevision,
    }),
    [
      located,
      open,
      blocking,
      panelOpen,
      setPanelOpen,
      active,
      hovered,
      pending,
      startDiscussion,
      onShowRevision,
    ],
  );
}

export const SpecDiscussionsContext = Context;
