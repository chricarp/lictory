import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { BookOpen } from "lucide-react";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useDecision } from "@lictory/platform/components/spaces/blocks/decisions";

// A recorded Work decision in a page (`decisionRef`): an inline chip in a
// sentence, a card when it stands alone in its paragraph. The decision's
// text stays canonical in Work (its immutable record); the page shows it as
// it is now, with the item and revision it was recorded on, and says when
// it was archived. What I cannot find shows only the label stored in the
// content.

const cardKey = new PluginKey("decisionCards");

// A paragraph whose only content is one decision reference (and spaces)
// shows it as a card. Recomputed per document, so typing beside a card
// turns it back into a chip at once.
export function decisionCardPlugin() {
  const build = (doc: PMNode) => {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name !== "paragraph") return node.isBlock;
      let found = -1;
      let alone = true;
      node.forEach((child, offset) => {
        if (child.type.name === "decisionRef") {
          if (found >= 0) alone = false;
          found = pos + 1 + offset;
        } else if (!(child.isText && !child.text?.trim())) alone = false;
      });
      if (found >= 0 && alone)
        decorations.push(
          Decoration.node(
            found,
            found + 1,
            { "data-layout": "card" },
            { card: true },
          ),
        );
      return false;
    });
    return DecorationSet.create(doc, decorations);
  };
  return new Plugin({
    key: cardKey,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations: (state) => cardKey.getState(state) as DecorationSet,
    },
  });
}

export function DecisionReference({ node, decorations }: ReactNodeViewProps) {
  const { organization } = useWorkspace();
  const decisionId = node.attrs.decisionId as string | null;
  const label = (node.attrs.label as string | null) ?? "Decision";
  const entry = useDecision(organization.id, decisionId);
  const card = decorations.some(
    (d) => (d.spec as { card?: boolean } | undefined)?.card,
  );
  const decision = entry.state === "ready" ? entry.decision : null;
  const title = decision?.title ?? label;
  const archived = Boolean(decision?.archivedAt);
  if (!card)
    return (
      <NodeViewWrapper
        as="span"
        className="page-ref decision-ref"
        data-type="decisionRef"
      >
        {decision?.href ? (
          <Link
            href={decision.href}
            title={`Decision${decision.key ? ` on ${decision.key}` : ""}: ${title}${archived ? " (archived)" : ""}`}
          >
            <BookOpen className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">Decision: </span>
            <span className="page-ref-title">{title}</span>
            {archived && (
              <span className="decision-ref-archived">Archived</span>
            )}
          </Link>
        ) : (
          <span title={label}>
            <BookOpen className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">Decision: </span>
            <span className="page-ref-title">{label}</span>
          </span>
        )}
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper
      as="span"
      className="decision-card"
      data-type="decisionRef"
      data-archived={archived || undefined}
      contentEditable={false}
    >
      <span className="decision-card-label">
        <BookOpen className="size-3.5" aria-hidden />
        Decision
        {archived && <span className="decision-card-archived">Archived</span>}
      </span>
      <span className="decision-card-title">
        {decision?.href ? <Link href={decision.href}>{title}</Link> : title}
      </span>
      {decision ? (
        <>
          {decision.excerpt && (
            <span className="decision-card-body">{decision.excerpt}</span>
          )}
          <span className="decision-card-meta">
            {decision.key && (
              <span className="font-mono tabular-nums">{decision.key}</span>
            )}
            {decision.itemTitle && <span>{decision.itemTitle}</span>}
            {decision.revisionNumber !== null && (
              <span>Recorded on revision {decision.revisionNumber}</span>
            )}
            {archived && (
              <span>
                Archived: withdrawn from active product knowledge, kept for
                history
              </span>
            )}
          </span>
        </>
      ) : (
        <span className="decision-card-meta">
          {entry.state === "loading"
            ? "Loading the decision…"
            : entry.state === "failed"
              ? "The decision could not be loaded right now."
              : "This decision is unavailable."}
        </span>
      )}
    </NodeViewWrapper>
  );
}
