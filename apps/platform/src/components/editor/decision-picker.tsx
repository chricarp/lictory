import { DropdownSurface, DropdownItem } from "@lictory/ui/dropdown";
import { useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { Scale } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { cn } from "@lictory/core/lib/utils";
import { ItemContext } from "@lictory/platform/components/items/item-context";
import { useReferences } from "@lictory/platform/components/references/data";
import { insertDecision } from "@lictory/platform/components/editor/commands";

// Finds a recorded decision to cite ("/" → Decision, or Insert → Decision):
// a search field at the caret (WAI-ARIA combobox), the open item's
// decisions first, then what the server finds among the decisions I may
// read. Enter inserts `[title](decision:ID)`; Escape returns to the text.

type Option = { id: string; title: string; detail: string };

type Result = {
  kind: string;
  id: string;
  title: string;
  key: string;
  revisionNumber?: number;
};

export function DecisionPicker({
  editor,
  onClose,
}: {
  editor: Editor;
  onClose: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const item = useContext(ItemContext);
  const { organizationId, item: itemOf } = useReferences();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [index, setIndex] = useState(0);
  const [rect] = useState(() => {
    try {
      const { from } = editor.state.selection;
      return editor.view.coordsAtPos(from);
    } catch {
      return { left: 16, bottom: 120, top: 100, right: 16 };
    }
  });

  const local: Option[] = (item?.entities ?? [])
    .flatMap((e) => (e.type === "decision" && !e.archivedAt ? [e] : []))
    .filter((d) => d.title.toLowerCase().includes(query.trim().toLowerCase()))
    .map((d) => ({
      id: d.id,
      title: d.title,
      detail: itemOf(d.workItemId)?.key ?? "This item",
    }));
  const options = [
    ...local,
    ...remote.filter((r) => !local.some((l) => l.id === r.id)),
  ].slice(0, 10);

  useEffect(() => {
    if (!organizationId) return;
    let live = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      callCapability<{ results: Result[] }>("searchProductKnowledge", {
        organizationId,
        query: query.trim(),
        limit: 20,
      })
        .then(({ results }) => {
          if (!live) return;
          setError("");
          setRemote(
            results
              .filter((r) => r.kind === "decision")
              .map((r) => ({
                id: r.id,
                title: r.title,
                detail:
                  r.revisionNumber != null
                    ? `${r.key} · revision ${r.revisionNumber}`
                    : r.key,
              })),
          );
        })
        .catch((e: unknown) => {
          if (live)
            setError(
              e instanceof Error
                ? e.message
                : "Decisions could not be searched.",
            );
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 180);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [organizationId, query]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const close = () => {
    onClose();
    editor.commands.focus();
  };
  const choose = (option: Option | undefined) => {
    if (!option) return;
    onClose();
    insertDecision(editor, null, option);
  };

  const top = Math.min(rect.bottom + 6, window.innerHeight - 320);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 328));
  const active = Math.min(index, Math.max(0, options.length - 1));
  return createPortal(
    <DropdownSurface style={{ top, left }} className="fixed w-80">
      <label htmlFor={`${id}-input`} className="sr-only">
        Find a decision
      </label>
      <input
        ref={input}
        id={`${id}-input`}
        role="combobox"
        aria-expanded
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={options.length ? `${id}-${active}` : undefined}
        placeholder="Find a decision…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onBlur={(e) => {
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget))
            onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            const step = e.key === "ArrowDown" ? 1 : -1;
            if (options.length)
              setIndex((active + step + options.length) % options.length);
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        className="h-10 w-full border-b bg-transparent px-3 text-[13px] outline-none placeholder:text-muted-foreground touch:text-base"
      />
      <ul
        id={`${id}-list`}
        role="listbox"
        aria-label="Decisions"
        className="max-h-64 overflow-y-auto p-1"
      >
        {options.map((option, i) => (
          // Keys stay in the field (aria-activedescendant); pointers pick here.
          <DropdownItem asChild key={option.id}>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
            <li
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
              className={cn(
                "items-start",
                i === active && "bg-accent text-accent-foreground",
              )}
            >
              <Scale
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2">{option.title}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">
                  {option.detail}
                </span>
              </span>
            </li>
          </DropdownItem>
        ))}
      </ul>
      {!options.length && (
        <p
          role="status"
          className="px-3 pb-2.5 text-[13px] text-muted-foreground"
        >
          {error ||
            (loading ? "Searching decisions…" : "No recorded decisions match.")}
        </p>
      )}
    </DropdownSurface>,
    document.body,
  );
}
