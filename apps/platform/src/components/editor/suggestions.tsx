import { DropdownSurface, DropdownItem } from "@lictory/ui/dropdown";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Pin } from "lucide-react";
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
  // Short, beside the label (a work item's key, a handle).
  hint?: string;
  // Longer, on a second line (a page's space and parent pages).
  detail?: string;
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
  // The pointer moved onto an option.
  point(index: number) {
    const state = this.state;
    if (state && state.index !== index && state.items[index])
      this.set({ ...state, index });
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

const MENU_WIDTH = 320;
const GAP = 6;

// Below the caret, or above it when that fits better; within the editor's
// width when the editor is wide enough, and always within the window.
function placeMenu(
  caret: DOMRect,
  height: number,
  bounds: DOMRect | null,
): { top: number; left: number } {
  const width = Math.min(MENU_WIDTH, window.innerWidth - 16);
  const below = caret.bottom + GAP;
  const above = caret.top - GAP - height;
  const top =
    below + height <= window.innerHeight - 8 || above < 8
      ? Math.min(below, Math.max(8, window.innerHeight - 8 - height))
      : above;
  const [min, max] =
    bounds && bounds.width >= width
      ? [
          Math.max(8, bounds.left),
          Math.min(window.innerWidth - 8, bounds.right),
        ]
      : [8, window.innerWidth - 8];
  const left = Math.max(min, Math.min(caret.left, max - width));
  return { top, left };
}

export function SuggestionMenu({ store }: { store: MenuStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const rect = state?.rect ?? null;
  const count = state?.items.length ?? 0;
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!rect || !panel) return;
    let bounds: DOMRect | null = null;
    try {
      bounds = store.editor?.isDestroyed
        ? null
        : (store.editor?.view.dom.getBoundingClientRect() ?? null);
    } catch {
      bounds = null;
    }
    setPosition(placeMenu(rect, panel.offsetHeight, bounds));
  }, [rect, count, store]);
  if (!state?.rect) return null;
  const active = state.items[state.index];
  const alternateId = `${store.id}-alternate`;
  return createPortal(
    <DropdownSurface
      ref={panelRef}
      style={{
        top: position?.top ?? -9999,
        left: position?.left ?? -9999,
        width: MENU_WIDTH,
      }}
      className="fixed"
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
          className="max-h-72 overflow-y-auto p-1"
        >
          {state.items.map((item, index) => {
            const current = index === state.index;
            return (
              // Keys are handled by the editor, which keeps focus and points
              // aria-activedescendant at the chosen option.
              <DropdownItem asChild key={item.id}>
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
                <li
                  id={`${store.id}-${index}`}
                  role="option"
                  aria-selected={current}
                  // The active option says how to take its alternative.
                  aria-describedby={
                    current && item.alternate ? alternateId : undefined
                  }
                  title={
                    item.detail ? `${item.label}\n${item.detail}` : undefined
                  }
                  // The editor keeps focus; pointer users pick without blurring it.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => store.point(index)}
                  onClick={() => store.choose(index)}
                  className={cn(
                    item.detail ? "items-start" : "items-center",
                    current && "bg-accent text-accent-foreground",
                  )}
                >
                  {item.icon && (
                    <span
                      className={cn(
                        "text-muted-foreground",
                        item.detail && "mt-0.5",
                      )}
                      aria-hidden
                    >
                      {item.icon}
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="line-clamp-2 min-w-0 flex-1 break-words">
                        {item.label}
                      </span>
                      {item.hint && (
                        <span className="max-w-28 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
                          {item.hint}
                        </span>
                      )}
                    </span>
                    {item.detail && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.detail}
                      </span>
                    )}
                  </span>
                  {current && item.alternate && (
                    <button
                      type="button"
                      tabIndex={-1}
                      // Pointer path to the alternative; keyboard: Shift+Enter
                      // (the option's description).
                      aria-hidden
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        store.choose(index, true);
                      }}
                      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] text-muted-foreground ring-1 ring-foreground/10 hover:bg-background hover:text-foreground"
                    >
                      <Pin className="size-3" aria-hidden />
                      Pin
                      <kbd className="font-sans text-[10px] opacity-70">⇧↵</kbd>
                    </button>
                  )}
                </li>
              </DropdownItem>
            );
          })}
        </ul>
      ) : (
        <p className="px-3 pb-2.5 text-[13px] text-muted-foreground">
          {state.empty}
        </p>
      )}
      {active?.alternate && (
        <span id={alternateId} className="sr-only">
          Shift+Enter: {active.alternate.label}
        </span>
      )}
    </DropdownSurface>,
    document.body,
  );
}
