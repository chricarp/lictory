import type { ReactNode } from "react";
import type { AnyExtension, Node } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";
import { FileCode2 } from "lucide-react";
import {
  DecisionChip,
  ItemChip,
  PageChip,
  type ChipMode,
} from "@lictory/platform/components/references/chips";

// How references, mentions and verbatim Markdown look inside an editor (or a
// read-only document). One set of views for page drafts, page readers and
// Markdown editors, built on the shared reference chips.

const modeOf = (props: ReactNodeViewProps): ChipMode =>
  props.editor.isEditable ? "static" : "link";
const text = (value: unknown) => (typeof value === "string" ? value : null);

function WorkItemRefView(props: ReactNodeViewProps) {
  const { node, selected } = props;
  return (
    <NodeViewWrapper as="span" data-type="workItemRef" className="editor-ref">
      <ItemChip
        id={String(node.attrs.workItemId ?? "")}
        label={text(node.attrs.key)}
        mode={modeOf(props)}
        selected={selected && props.editor.isEditable}
      />
    </NodeViewWrapper>
  );
}

function PageRefView(props: ReactNodeViewProps) {
  const { node, selected } = props;
  return (
    <NodeViewWrapper as="span" data-type="pageRef" className="editor-ref">
      <PageChip
        id={String(node.attrs.pageId ?? "")}
        commitId={text(node.attrs.commitId)}
        label={text(node.attrs.label)}
        mode={modeOf(props)}
        selected={selected && props.editor.isEditable}
      />
    </NodeViewWrapper>
  );
}

function DecisionRefView(props: ReactNodeViewProps) {
  const { node, selected } = props;
  return (
    <NodeViewWrapper as="span" data-type="decisionRef" className="editor-ref">
      <DecisionChip
        id={String(node.attrs.decisionId ?? "")}
        label={text(node.attrs.label)}
        mode={modeOf(props)}
        selected={selected && props.editor.isEditable}
      />
    </NodeViewWrapper>
  );
}

function MentionView({ node }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper
      as="span"
      data-type="mention"
      data-id={String(node.attrs.id ?? "")}
      className="editor-mention"
    >
      @{text(node.attrs.label) ?? "member"}
    </NodeViewWrapper>
  );
}

function RawInlineView({ node }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper
      as="span"
      data-type="rawInline"
      className="editor-raw-inline"
    >
      {text(node.attrs.source)}
    </NodeViewWrapper>
  );
}

function RawBlockView({ node }: ReactNodeViewProps) {
  return (
    <NodeViewWrapper
      data-type="rawBlock"
      className="editor-raw-block"
      contentEditable={false}
    >
      <p className="editor-raw-label">
        <FileCode2 className="size-3.5" aria-hidden />
        Markdown kept as written. Edit it as Markdown to change it.
      </p>
      <pre>{text(node.attrs.source)}</pre>
    </NodeViewWrapper>
  );
}

const views: Record<string, (props: ReactNodeViewProps) => ReactNode> = {
  workItemRef: WorkItemRefView,
  pageRef: PageRefView,
  decisionRef: DecisionRefView,
  mention: MentionView,
  rawInline: RawInlineView,
  rawBlock: RawBlockView,
};

/** Gives the schema's reference, mention and raw nodes their React views. */
export function withNodeViews(extensions: AnyExtension[]): AnyExtension[] {
  return extensions.map((extension) => {
    const view = views[extension.name];
    if (!view) return extension;
    const inline = extension.name !== "rawBlock";
    return (extension as Node).extend({
      addNodeView: () =>
        ReactNodeViewRenderer(view, inline ? { as: "span" } : {}),
    });
  });
}
