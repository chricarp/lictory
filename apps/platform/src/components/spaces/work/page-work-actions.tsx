import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Editor } from "@tiptap/core";
import { toast } from "@lictory/ui/toast";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  versionOf,
  type PageHistory,
  type PageLine,
} from "@lictory/platform/components/spaces/editor/line";
import {
  TASK_TO_WORK_EVENT,
  type TaskToWorkDetail,
} from "@lictory/platform/components/spaces/blocks/views";
import {
  insertReferencesAfter,
  type DraftAnchor,
} from "@lictory/platform/components/spaces/work/draft-insert";
import type {
  CreatedItem,
  CreateFromPageRequest,
} from "@lictory/platform/components/spaces/work/create-from-page";

const CreateFromPageDialog = lazy(() =>
  import("@lictory/platform/components/spaces/work/create-from-page").then(
    (m) => ({ default: m.CreateFromPageDialog }),
  ),
);

// Work from the page on screen: the page offers "Create work item" (and
// "Draft proposals with Litto") on selected committed text and on open
// tasks, to people who can create work in some project. Live drafts are
// never a source: only the commit being read is.

type PageWorkActions = {
  start: (request: CreateFromPageRequest) => void;
  aiAvailable: boolean;
};
const PageWorkContext = createContext<PageWorkActions | null>(null);

// Null where the page offers no work actions (live editing, history
// previews, people who cannot create work).
export function usePageWorkActions() {
  return useContext(PageWorkContext);
}

const LIVE_EDITOR = '.page-document[role="textbox"]';
const WAIT_FOR_EDITOR_MS = 20_000;

export function PageWorkProvider({
  space,
  page,
  line,
  history,
  editing,
  onEdit,
  children,
}: {
  space: Space;
  page: SpacePage;
  line: PageLine;
  history: PageHistory;
  editing: boolean;
  // Opens main's live draft (Direct spaces).
  onEdit: () => void;
  children: ReactNode;
}) {
  const { projects, capabilitiesIn, directory } = useWorkspace();
  const commit = line.viewed ?? line.head;
  const canCreate = projects.some((p) => {
    if (p.archivedAt) return false;
    const c = capabilitiesIn(p.id);
    return c.editSpecifications || c.changeProperties;
  });
  const available = canCreate && !editing && Boolean(commit);
  // The new items can be mentioned in main's live draft when I edit it and
  // read its latest version.
  const canInsert =
    line.isMain && line.writable && line.draft !== null && !line.viewed;
  const [request, setRequest] = useState<CreateFromPageRequest | null>(null);
  const [pending, setPending] = useState<{
    items: CreatedItem[];
    anchor: DraftAnchor;
  } | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // "Create work item" on a task of the reader.
  useEffect(() => {
    const node = container.current;
    if (!node || !available) return;
    const onTask = (event: Event) => {
      const detail = (event as CustomEvent<TaskToWorkDetail>).detail;
      setRequest({
        origin: "task",
        quote: detail.text,
        title: detail.text.slice(0, 240),
        topBlockId: detail.topBlockId,
        anchor: { blockId: detail.blockId, before: detail.text },
        mode: "write",
      });
    };
    node.addEventListener(TASK_TO_WORK_EVENT, onTask);
    return () => node.removeEventListener(TASK_TO_WORK_EVENT, onTask);
  }, [available]);

  // After "Add to the page": once the live draft is open and editable,
  // mention the new items after their source text.
  useEffect(() => {
    if (!pending || !editing) return;
    const started = Date.now();
    let timer = 0;
    const attempt = () => {
      const dom = container.current?.querySelector<
        HTMLElement & { editor?: Editor }
      >(LIVE_EDITOR);
      const editor = dom?.editor;
      if (editor && !editor.isDestroyed && editor.isEditable) {
        const placed = insertReferencesAfter(
          editor,
          pending.anchor,
          pending.items.map((i) => ({ workItemId: i.workItemId, key: i.key })),
        );
        const keys = pending.items.map((i) => i.key).join(", ");
        toast.add({
          title:
            placed === "placed"
              ? `Mentioned ${keys} on the page`
              : `Added ${keys} at the end of the page`,
          description:
            placed === "placed"
              ? "The draft now refers to the new work. Publish when you are ready."
              : "The original text is no longer in the draft. Move the mention where it belongs, then publish.",
          timeout: 8000,
        });
        setPending(null);
        return;
      }
      if (Date.now() - started > WAIT_FOR_EDITOR_MS) {
        toast.add({
          title: "The page was not changed",
          description:
            "The editor did not open in time. Mention the new work with # in the editor.",
          type: "error",
          timeout: 8000,
        });
        setPending(null);
        return;
      }
      timer = window.setTimeout(attempt, 150);
    };
    attempt();
    return () => window.clearTimeout(timer);
  }, [pending, editing]);

  const start = useCallback(
    (next: CreateFromPageRequest) => setRequest(next),
    [],
  );
  const value = useMemo<PageWorkActions | null>(
    () =>
      available
        ? {
            start,
            aiAvailable: directory.ai.available && directory.ai.enabled,
          }
        : null,
    [available, start, directory.ai.available, directory.ai.enabled],
  );
  return (
    <PageWorkContext.Provider value={value}>
      <div ref={container} data-work-actions={available || undefined}>
        {children}
      </div>
      {request && commit && (
        <Suspense fallback={null}>
          <CreateFromPageDialog
            request={request}
            space={space}
            page={page}
            commit={{
              id: commit.id,
              title: commit.title,
              version: versionOf(history.commits, commit.id),
            }}
            canInsert={canInsert}
            onInsert={(items, anchor) => {
              setRequest(null);
              setPending({ items, anchor });
              onEdit();
            }}
            onClose={() => setRequest(null)}
          />
        </Suspense>
      )}
    </PageWorkContext.Provider>
  );
}
