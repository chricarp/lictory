import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useId,
  useRef,
  useState,
} from "react";
import { Extension, InputRule, type Editor } from "@tiptap/core";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Loader } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { markdownExtensions } from "@lictory/core/editor/schema";
import {
  blockKey,
  parseMarkdown,
  renderBlock,
  serializeBlocks,
  type MarkdownJSON,
  type MarkdownSource,
} from "@lictory/core/editor/markdown";
import { useAttachmentsAvailable } from "@lictory/platform/lib/session";
import { ACCEPT_FILES } from "@lictory/platform/components/items/file-upload";
import { useReferences } from "@lictory/platform/components/references/data";
import { withNodeViews } from "@lictory/platform/components/editor/node-views";
import {
  MenuStore,
  SuggestionMenu,
  suggestionExtension,
} from "@lictory/platform/components/editor/suggestions";
import {
  insertFiles,
  mentionItems,
  pageItems,
  slashItems,
  workItemItems,
} from "@lictory/platform/components/editor/commands";
import { Toolbar } from "@lictory/platform/components/editor/toolbar";
import { DecisionPicker } from "@lictory/platform/components/editor/decision-picker";
import type {
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from "@lictory/platform/components/editor/markdown-editor";
import "@lictory/platform/components/editor/document.css";

// The rich editor for Markdown documents (specifications, descriptions,
// discussions, decisions): the page editor's schema, toolbar, pickers and
// chips, with Markdown in and out instead of a live draft. The value stays
// Markdown; unchanged blocks keep their exact text (core/editor/markdown.ts),
// so opening and saving without edits changes nothing.

// Keys and rendered Markdown per document node: ProseMirror reuses the
// nodes an edit did not touch, so a keystroke re-serializes one block.
type Cached = { key: string; json: MarkdownJSON; text: Map<string, string> };
const cache = new WeakMap<PMNode, Cached>();
function cached(node: PMNode): Cached {
  let entry = cache.get(node);
  if (!entry) {
    const json = node.toJSON() as MarkdownJSON;
    entry = { key: blockKey(json), json, text: new Map() };
    cache.set(node, entry);
  }
  return entry;
}

function markdownOf(doc: PMNode, source: MarkdownSource) {
  const children: PMNode[] = [];
  doc.forEach((child) => children.push(child));
  const entries = children.map(cached);
  const byJson = new Map(entries.map((e) => [e.json, e]));
  return serializeBlocks(
    entries.map((e) => ({ key: e.key, json: () => e.json })),
    source,
    (json, hint) => {
      const entry = byJson.get(json);
      const hintKey = `${hint.bullet}${hint.delimiter}`;
      const known = entry?.text.get(hintKey);
      if (known !== undefined) return known;
      const text = renderBlock(json, hint);
      entry?.text.set(hintKey, text);
      return text;
    },
  );
}

// Behaviour beyond the schema: Mod+Enter submits, Escape leaves (unless a
// picker is open), files dropped or pasted are uploaded, pasted plain text
// is read as Markdown, and "@handle " links a teammate without the picker.
const MarkdownEditing = Extension.create<{
  submit: () => boolean;
  escape: () => boolean;
  upload: (editor: Editor, files: File[], at?: number) => boolean;
  handles: () => { id: string; name: string; handle?: string | null }[];
}>({
  name: "markdownEditing",
  priority: 1000,
  addOptions: () => ({
    submit: () => false,
    escape: () => false,
    upload: () => false,
    handles: () => [],
  }),
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => this.options.submit(),
      Escape: () => this.options.escape(),
    };
  },
  addInputRules() {
    const { options } = this;
    return [
      new InputRule({
        find: /(?:^|\s)@([A-Za-z0-9_]{3,30})([\s.,;:!?)])$/,
        handler: ({ range, match, chain }) => {
          const handle = match[1]!.toLowerCase();
          const person = options.handles().find((p) => p.handle === handle);
          if (!person) return null;
          const start = range.to - match[1]!.length - 1;
          chain()
            .deleteRange({ from: start, to: range.to })
            .insertContentAt(start, [
              {
                type: "mention",
                attrs: { id: person.id, label: person.handle ?? person.name },
              },
              { type: "text", text: match[2]! },
            ])
            .run();
        },
      }),
    ];
  },
  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new Plugin({
        props: {
          handleDrop: (view, event, _slice, moved) => {
            if (moved || !event.dataTransfer?.files.length) return false;
            const at = view.posAtCoords({
              left: event.clientX,
              top: event.clientY,
            })?.pos;
            const handled = options.upload(
              editor,
              [...event.dataTransfer.files],
              at,
            );
            if (handled) event.preventDefault();
            return handled;
          },
          handlePaste: (view, event) => {
            const files = [...(event.clipboardData?.files ?? [])];
            if (files.length) return options.upload(editor, files);
            const html = event.clipboardData?.getData("text/html");
            const text = event.clipboardData?.getData("text/plain");
            if (
              html ||
              !text ||
              view.state.selection.$from.parent.type.spec.code
            )
              return false;
            // Plain text is read as Markdown, so pasted specifications keep
            // their headings, lists and references.
            const { doc } = parseMarkdown(text, view.state.schema);
            const fragment = Fragment.fromJSON(view.state.schema, doc.content);
            view.dispatch(
              view.state.tr
                .replaceSelection(Slice.maxOpen(fragment))
                .scrollIntoView(),
            );
            return true;
          },
        },
      }),
    ];
  },
});

const imageAndFileInput = ACCEPT_FILES;

const RichMarkdownEditor = forwardRef<
  MarkdownEditorHandle,
  MarkdownEditorProps
>(function RichMarkdownEditor(
  {
    value,
    onValueChange,
    id,
    placeholder,
    mentions,
    fileContext: requestedFileContext,
    onSubmit,
    onEscape,
    onBlur,
    disabled = false,
    autoFocus = false,
    compact = false,
    minHeight,
    maxHeight,
    className,
    containerClassName,
    references = true,
    ...aria
  },
  ref,
) {
  const generatedId = useId();
  const editorId = id ?? `${generatedId}-editor`;
  const fileContext = useAttachmentsAvailable()
    ? requestedFileContext
    : undefined;
  const resolver = useReferences();
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [source, setSource] = useState(false);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Everything the editor's callbacks read, current after every render,
  // so the editor is created once.
  const latest = useRef({
    onValueChange,
    onSubmit,
    onEscape,
    onBlur,
    mentions,
    resolver,
    fileContext,
  });
  useEffect(() => {
    latest.current = {
      onValueChange,
      onSubmit,
      onEscape,
      onBlur,
      mentions,
      resolver,
      fileContext,
    };
  });
  // The Markdown the document was read from, and the last value sent up.
  const sourceRef = useRef<MarkdownSource>(null as never);
  if (!sourceRef.current) sourceRef.current = parseMarkdown(value);
  const emitted = useRef(value);

  const [menus] = useState(() => ({
    slash: new MenuStore(),
    items: new MenuStore(),
    pages: new MenuStore(),
    people: new MenuStore(),
  }));
  const menuOpen = () =>
    Object.values(menus).some((m) => m.getSnapshot() !== null);

  const upload = useCallback((editor: Editor, files: File[], at?: number) => {
    const context = latest.current.fileContext;
    if (!context || !files.length) return false;
    setUploading((n) => n + files.length);
    setUploadError("");
    void insertFiles(editor, files, context, at)
      .catch((e: unknown) =>
        setUploadError(e instanceof Error ? e.message : "File upload failed."),
      )
      .finally(() => setUploading((n) => n - files.length));
    return true;
  }, []);
  const pickFile = useCallback(() => fileInput.current?.click(), []);
  const hasFiles = Boolean(fileContext);
  const hasMentions = Boolean(mentions?.length);

  const attributes: Record<string, string> = {
    id: editorId,
    class: cn(
      "page-document markdown-document outline-none",
      compact && "markdown-document-compact",
      className,
    ),
    role: "textbox",
    "aria-multiline": "true",
    ...(placeholder ? { "aria-placeholder": placeholder } : {}),
    ...Object.fromEntries(
      Object.entries(aria).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    "data-markdown-editor": "",
  };
  const attributesKey = JSON.stringify(attributes);

  const editor = useEditor(
    {
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editable: !disabled,
      content: sourceRef.current.doc,
      extensions: [
        ...withNodeViews(markdownExtensions()),
        UndoRedo,
        Placeholder.configure({
          placeholder:
            placeholder ??
            (references
              ? "Write, or type / for blocks, # for a work item, [[ for a page"
              : "Write…"),
        }),
        suggestionExtension("slashMenu", {
          char: "/",
          title: "Insert",
          empty: "No matching blocks",
          store: menus.slash,
          items: (query) =>
            slashItems(query, {
              file: latest.current.fileContext ? pickFile : undefined,
              decision:
                references && latest.current.resolver.organizationId
                  ? () => setDecisionOpen(true)
                  : undefined,
              mention: Boolean(latest.current.mentions?.length),
            }).filter(
              (item) =>
                references ||
                !["workItem", "pageLink", "decision"].includes(item.id),
            ),
        }),
        ...(references
          ? [
              suggestionExtension("workItemMenu", {
                char: "#",
                title: "Work items",
                empty: "No matching work items you can see",
                store: menus.items,
                items: (query) =>
                  workItemItems(query, latest.current.resolver.items()),
              }),
              suggestionExtension("pageMenu", {
                char: "[[",
                allowSpaces: true,
                title: "Pages",
                empty: "No matching pages you can read",
                store: menus.pages,
                items: (query) =>
                  pageItems(query, latest.current.resolver.pages()),
              }),
            ]
          : []),
        // Only fields that mention offer "@"; elsewhere it is just text.
        ...(hasMentions
          ? [
              suggestionExtension("mentionMenu", {
                char: "@",
                title: "People",
                empty: "No matching people",
                store: menus.people,
                items: (query) =>
                  mentionItems(query, latest.current.mentions ?? []),
              }),
            ]
          : []),
        MarkdownEditing.configure({
          submit: () => {
            if (!latest.current.onSubmit || menuOpen()) return false;
            latest.current.onSubmit();
            return true;
          },
          escape: () => {
            if (!latest.current.onEscape || menuOpen()) return false;
            latest.current.onEscape();
            return true;
          },
          upload,
          handles: () =>
            (latest.current.mentions ?? []).filter((m) => m.handle),
        }),
      ],
      editorProps: { attributes },
      onUpdate: ({ editor: e, transaction }) => {
        if (!transaction.docChanged) return;
        const next = markdownOf(e.state.doc, sourceRef.current);
        if (next === emitted.current) return;
        emitted.current = next;
        latest.current.onValueChange(next);
      },
      onBlur: () => latest.current.onBlur?.(),
    },
    [],
  );
  useEffect(() => {
    for (const menu of Object.values(menus)) menu.attach(editor);
  }, [editor, menus]);
  // Labels change with context ("Comment on selection").
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: JSON.parse(attributesKey) as Record<string, string>,
      },
    });
  }, [editor, attributesKey]);

  // A value set from outside (a reset after posting, "load revision N")
  // replaces the document; the value we sent ourselves never does.
  useEffect(() => {
    if (!editor || value === emitted.current) return;
    sourceRef.current = parseMarkdown(value);
    emitted.current = value;
    editor.commands.setContent(sourceRef.current.doc, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable === disabled)
      editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (autoFocus && editor && !disabled)
      editor.commands.focus("end", { scrollIntoView: false });
    // Only when the editor appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus("end"),
    }),
    [editor],
  );

  const toggleSource = () => {
    if (source && editor) {
      // Back from Markdown text: read it as the new starting point.
      sourceRef.current = parseMarkdown(emitted.current);
      editor.commands.setContent(sourceRef.current.doc, {
        emitUpdate: false,
      });
      requestAnimationFrame(() => editor.commands.focus());
    }
    setSource((on) => !on);
  };

  const toolbar = editor ? (
    <Toolbar
      editor={editor}
      disabled={disabled}
      compact={compact}
      label={`${aria["aria-label"] ?? "Text"} formatting`}
      onFile={hasFiles ? pickFile : undefined}
      onDecision={
        references && resolver.organizationId
          ? () => setDecisionOpen(true)
          : undefined
      }
      mentions={hasMentions}
      source={compact ? undefined : { active: source, toggle: toggleSource }}
      className={cn(
        "rounded-none border-0 bg-transparent px-1.5 shadow-none",
        compact ? "py-0.5" : "py-1",
      )}
    />
  ) : null;

  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col rounded-lg border bg-card focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10",
        disabled && "opacity-60",
        containerClassName,
      )}
    >
      {!compact && (
        <div className="sticky top-0 z-10 rounded-t-[inherit] border-b bg-card/95 backdrop-blur">
          {toolbar}
        </div>
      )}
      {source ? (
        <textarea
          value={emitted.current}
          onChange={(e) => {
            emitted.current = e.target.value;
            onValueChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onSubmit) {
              e.preventDefault();
              onSubmit();
            } else if (e.key === "Escape" && onEscape) {
              // Handled: an enclosing dialog must not also close.
              e.preventDefault();
              onEscape();
            }
          }}
          aria-label={`${aria["aria-label"] ?? "Text"} (Markdown)`}
          spellCheck
          disabled={disabled}
          style={{ minHeight, maxHeight }}
          className="w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-6 outline-none touch:text-base"
        />
      ) : (
        <div
          className={cn(
            "min-w-0 cursor-text overflow-y-auto",
            compact ? "px-3 pt-2.5 pb-2" : "px-4 py-3",
          )}
          style={{ minHeight, maxHeight }}
        >
          <EditorContent editor={editor} className="h-full min-h-[inherit]" />
        </div>
      )}
      {uploadError && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {uploadError}
        </p>
      )}
      {uploading > 0 && (
        <p
          role="status"
          className="flex items-center gap-1.5 px-3 pb-2 text-xs text-muted-foreground"
        >
          <Loader className="size-3.5 animate-spin" aria-hidden /> Uploading…
        </p>
      )}
      {compact && <div className="border-t px-0.5">{toolbar}</div>}
      {hasFiles && (
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={imageAndFileInput}
          hidden
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (editor) upload(editor, files);
          }}
        />
      )}
      <SuggestionMenu store={menus.slash} />
      <SuggestionMenu store={menus.items} />
      <SuggestionMenu store={menus.pages} />
      <SuggestionMenu store={menus.people} />
      {decisionOpen && editor && (
        <DecisionPicker
          editor={editor}
          onClose={() => setDecisionOpen(false)}
        />
      )}
    </div>
  );
});

export default RichMarkdownEditor;
