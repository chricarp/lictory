import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/core";
import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { ListTodo, RefreshCw, Settings2 } from "lucide-react";
import { iterationLabel } from "@lictory/core/contracts/protocol";
import {
  workListAttrs,
  workListLabels,
  type WorkListAttrs,
} from "@lictory/core/spaces/document/blocks";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  MoreRows,
  rollup,
  useWorkFacts,
  WorkRow,
  type WorkFact,
} from "@lictory/platform/components/spaces/work/work-row";
import { blockRequests } from "@lictory/platform/components/spaces/blocks/insert-store";

// A work list in a page: a read-only, live list of the items its stored
// query names (an epic's children, an iteration, a label, or the work the
// page mentions), as each reader can see them now. Nothing about the items
// is stored in the page and nothing is changed from here: the item's
// delivery owner (Lictory or the delivery tool) keeps its state. Counts
// cover only the items shown.

// Shown at first, and added by each "Show more".
const PAGE = 10;

function referencedIds(doc: PMNode) {
  const ids: string[] = [];
  doc.descendants((node) => {
    if (node.type.name === "workItemRef") {
      const id = node.attrs.workItemId as string | null;
      if (id && !ids.includes(id)) ids.push(id);
    }
    return true;
  });
  return ids;
}

// The work items the document mentions, following edits in a live draft.
function useReferenced(editor: Editor, enabled: boolean) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled) return () => undefined;
      editor.on("update", listener);
      return () => {
        editor.off("update", listener);
      };
    },
    [editor, enabled],
  );
  return useSyncExternalStore(subscribe, () =>
    enabled && !editor.isDestroyed
      ? referencedIds(editor.state.doc).join(",")
      : "",
  );
}

export function useWorkList(attrs: WorkListAttrs, editor: Editor) {
  const facts = useWorkFacts();
  const { projects, labels, delivery } = useWorkspace();
  const referenced = useReferenced(editor, attrs.filter === "referenced");
  return useMemo(() => {
    const project = projects.find((p) => p.id === attrs.projectId);
    let rows: WorkFact[];
    let label: string;
    if (attrs.filter === "referenced") {
      rows = referenced
        .split(",")
        .filter(Boolean)
        .map((id) => facts.get(id))
        .filter(
          (f): f is WorkFact =>
            !!f && (!attrs.projectId || f.item.projectId === attrs.projectId),
        );
      label = workListLabels.referenced;
    } else {
      const inProject = facts.all.filter(
        (i) => i.projectId === attrs.projectId,
      );
      const matching =
        attrs.filter === "epic-children"
          ? inProject.filter((i) => i.parentId === attrs.filterId)
          : attrs.filter === "iteration"
            ? inProject.filter((i) => i.iterationId === attrs.filterId)
            : inProject.filter((i) => i.labelIds.includes(attrs.filterId!));
      rows = matching
        .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
        .map(facts.fact);
      if (attrs.filter === "epic-children") {
        const epic = attrs.filterId ? facts.get(attrs.filterId) : undefined;
        label = epic ? `Children of ${epic.key}` : workListLabels[attrs.filter];
      } else if (attrs.filter === "iteration") {
        const iteration = attrs.filterId
          ? delivery.iterations.get(attrs.filterId)
          : undefined;
        label = iteration
          ? `${project ? `${project.key} ` : ""}${iterationLabel(iteration, project?.iterationMode)}`
          : workListLabels.iteration;
      } else {
        const found = labels.find((l) => l.id === attrs.filterId);
        label = found ? `Label: ${found.name}` : workListLabels.label;
      }
    }
    // `scope` says what the list holds when a title of its own does not.
    return {
      rows,
      label: attrs.title ?? label,
      scope: attrs.title ? label : null,
      project,
    };
  }, [attrs, referenced, facts, projects, labels, delivery]);
}

export function WorkListView({ node, editor, getPos }: ReactNodeViewProps) {
  const attrs = useMemo(
    () => workListAttrs({ type: "workList", attrs: node.attrs }),
    [node.attrs],
  );
  const { rows, label, scope } = useWorkList(attrs, editor);
  const [visible, setVisible] = useState(PAGE);
  const { done, total } = rollup(rows);
  const shown = rows.slice(0, visible);
  const editable = editor.isEditable;
  const headingId = `work-list-${(node.attrs.id as string | null) ?? "new"}`;
  return (
    <NodeViewWrapper
      className="work-list"
      data-type="workList"
      contentEditable={false}
    >
      <section aria-labelledby={headingId} data-testid="work-list">
        <header className="work-list-header">
          <ListTodo className="size-3.5 text-muted-foreground" aria-hidden />
          <h4 id={headingId} className="work-list-title">
            {label}
          </h4>
          <span className="work-list-meta">
            {scope && <span className="work-list-scope">{scope} · </span>}
            <span data-testid="work-list-count">
              {total === 0 ? "No items" : `${done} of ${total} done`}
            </span>
          </span>
          {editable && (
            <button
              type="button"
              className="work-list-edit"
              aria-label={`Change ${label}`}
              title="Change what this list shows"
              onClick={() => {
                const pos = typeof getPos === "function" ? getPos() : null;
                if (typeof pos !== "number") return;
                blockRequests.open({
                  kind: "workList",
                  editor,
                  at: pos,
                  existing: { pos, attrs },
                });
              }}
            >
              <Settings2 className="size-3.5" aria-hidden />
            </button>
          )}
        </header>
        {rows.length ? (
          <ul className="work-list-rows" aria-label={label}>
            {shown.map((fact) => (
              <WorkRow key={fact.item.id} fact={fact} compact />
            ))}
          </ul>
        ) : (
          <p className="work-list-empty">
            {attrs.filter === "referenced"
              ? "Work items mentioned on this page appear here."
              : "No work items you can see match this list."}
          </p>
        )}
        <MoreRows
          total={rows.length}
          visible={visible}
          page={PAGE}
          onChange={setVisible}
          className="work-list-more"
        />
        <p className="work-list-note">
          <RefreshCw className="size-3 shrink-0" aria-hidden />
          Live from Lictory Work. Open an item to change it.
        </p>
      </section>
    </NodeViewWrapper>
  );
}
