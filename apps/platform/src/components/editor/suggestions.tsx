import { useId, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Extension, type Editor, type Range } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { cn } from "@lictory/core/lib/utils";

// Inline pickers typed into a document: "/" for blocks and actions, "#"
// for a work item, "[[" for a page, "@" for a person. One small store per
// picker feeds a React listbox; the editor keeps focus and owns the keys
// while it is open (arrows choose, Enter or Tab inserts, Shift+Enter the
// option's alternative such as pinning a page version, Escape closes), and
// points `aria-activedescendant` at the chosen option. Shared by page
// drafts and Markdown editors.

export type MenuItem = {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  run: (editor: Editor, range: Range) => void;
  // A second way to insert this option (Shift+Enter, or its button).
  alternate?: {
    label: string;
    run: (editor: Editor, range: Range) => void;
  };
};

type MenuState = {
  title: string;
  items: MenuItem[];
  index: number;
  rect: DOMRect | null;
  range: Range;
  empty: string;
} | null;

export class MenuStore {
  private state: MenuState = null;
  private listeners = new Set<() => void>();
  readonly id = `editor-menu-${Math.random().toString(36).slice(2)}`;
  editor: Editor | null = null;
  attach(editor: Editor | null) {
    this.editor = editor;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  set(next: MenuState) {
    this.state = next;
    let dom: HTMLElement | null = null;
    try {
      // An unmounted editor (a replaced draft closing) has no view.
      dom = this.editor?.isDestroyed ? null : (this.editor?.view.dom ?? null);
    } catch {
      dom = null;
    }
    if (dom) {
      if (next?.items.length) {
        dom.setAttribute("aria-controls", this.id);
        dom.setAttribute("aria-activedescendant", `${this.id}-${next.index}`);
      } else {
        dom.removeAttribute("aria-controls");
        dom.removeAttribute("aria-activedescendant");
      }
    }
    for (const listener of this.listeners) listener();
  }
  choose(index: number, alternate = false) {
    const state = this.state;
    const item = state?.items[index];
    if (!state || !item || !this.editor) return;
    this.set(null);
    (alternate && item.alternate ? item.alternate.run : item.run)(
      this.editor,
      state.range,
    );
  }
  // Items computed after the menu opened (a search answering).
  refresh(items: MenuItem[]) {
    const state = this.state;
    if (state)
      this.set({
        ...state,
        items,
        index: Math.min(state.index, Math.max(0, items.length - 1)),
      });
  }
}

export function suggestionExtension(
  name: string,
  options: {
    char: string;
    allowSpaces?: boolean;
    title: string;
    empty: string;
    store: MenuStore;
    items: (query: string) => MenuItem[];
  },
) {
  const { store } = options;
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [
        Suggestion<MenuItem, MenuItem>({
          editor: this.editor,
          char: options.char,
          allowSpaces: options.allowSpaces ?? false,
          pluginKey: new PluginKey(name),
          decorationClass: "page-suggestion-query",
          items: ({ query }) => options.items(query),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (props) => {
              store.attach(props.editor);
              store.set({
                title: options.title,
                empty: options.empty,
                items: props.items,
                index: 0,
                rect: props.clientRect?.() ?? null,
                range: props.range,
              });
            },
            onUpdate: (props) =>
              store.set({
                title: options.title,
                empty: options.empty,
                items: props.items,
                index: 0,
                rect: props.clientRect?.() ?? null,
                range: props.range,
              }),
            onKeyDown: ({ event }) => {
              const state = store.getSnapshot();
              if (!state) return false;
              if (event.key === "Escape") {
                // Closing the picker is all Escape does (not a dialog).
                event.stopPropagation();
                store.set(null);
                return true;
              }
              if (!state.items.length) return false;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                const step = event.key === "ArrowDown" ? 1 : -1;
                store.set({
                  ...state,
                  index:
                    (state.index + step + state.items.length) %
                    state.items.length,
                });
                return true;
              }
              if (event.key === "Enter" && event.shiftKey) {
                store.choose(state.index, true);
                return true;
              }
              if (
                (event.key === "Enter" || event.key === "Tab") &&
                !event.metaKey &&
                !event.ctrlKey
              ) {
                store.choose(state.index);
                return true;
              }
              return false;
            },
            onExit: () => store.set(null),
          }),
        }),
      ];
    },
  });
}

export function SuggestionMenu({ store }: { store: MenuStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const titleId = useId();
  if (!state?.rect) return null;
  const top = Math.min(state.rect.bottom + 6, window.innerHeight - 280);
  const left = Math.min(state.rect.left, window.innerWidth - 300);
  return createPortal(
    <div
      style={{ top, left: Math.max(8, left) }}
      className="fixed z-50 w-72 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10"
    >
      <p
        id={titleId}
        className="px-3 pt-2 pb-1 font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase"
      >
        {state.title}
      </p>
      {state.items.length ? (
        <ul
          id={store.id}
          role="listbox"
          aria-labelledby={titleId}
          className="max-h-64 overflow-y-auto p-1"
        >
          {state.items.map((item, index) => (
            // Keys are handled by the editor, which keeps focus and points
            // aria-activedescendant at the chosen option.
            // eslint-disable-next-line jsx-a11y/click-events-have-key-events
            <li
              key={item.id}
              id={`${store.id}-${index}`}
              role="option"
              aria-selected={index === state.index}
              // The editor keeps focus; pointer users pick without blurring it.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => store.choose(index)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px]",
                index === state.index && "bg-muted",
              )}
            >
              {item.icon && (
                <span className="text-muted-foreground" aria-hidden>
                  {item.icon}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && (
                <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                  {item.hint}
                </span>
              )}
              {item.alternate && (
                <button
                  type="button"
                  tabIndex={-1}
                  // Pointer path to the alternative; keyboard: Shift+Enter.
                  aria-hidden
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    store.choose(index, true);
                  }}
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-foreground/10 hover:bg-background hover:text-foreground"
                >
                  {item.alternate.label}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-3 pb-2.5 text-[13px] text-muted-foreground">
          {state.empty}
        </p>
      )}
      {state.items[state.index]?.alternate && (
        <p
          id={`${store.id}-hint`}
          className="border-t px-3 py-1.5 text-[11px] text-muted-foreground"
        >
          ⇧↵ {state.items[state.index]!.alternate!.label}
        </p>
      )}
    </div>,
    document.body,
  );
}
