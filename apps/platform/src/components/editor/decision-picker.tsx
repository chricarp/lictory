import { useContext, useEffect, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/react/command";
import { Popover, PopoverContent } from "@ui-sdk/react/popover";
import type { Editor } from "@tiptap/core";
import { ownName } from "@lictory/ui/named";
import { Scale } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { cn } from "@lictory/core/lib/utils";
import { dropdownContentClass, dropdownItemClass } from "@lictory/ui/dropdown";
import { popupContainer } from "@lictory/ui/popup";
import { ItemContext } from "@lictory/platform/components/items/item-context";
import { useReferences } from "@lictory/platform/components/references/data";
import { insertDecision } from "@lictory/platform/components/editor/commands";

// Finds a recorded decision to cite ("/" → Decision, or Insert → Decision):
// a search field with its list at the caret, the open item's decisions
// first, then what the server finds among the decisions I may read. Enter
// inserts `[title](decision:ID)`; Escape returns to the text.

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
  const input = useRef<HTMLInputElement>(null);
  const item = useContext(ItemContext);
  const { organizationId, item: itemOf } = useReferences();
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [caret] = useState(() => {
    let rect = new DOMRect(16, 100, 0, 20);
    try {
      const { from } = editor.state.selection;
      const at = editor.view.coordsAtPos(from);
      rect = new DOMRect(at.left, at.top, 0, at.bottom - at.top);
    } catch {
      // An editor without a view yet: the picker opens near the top.
    }
    return { getBoundingClientRect: () => rect };
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

  // The picker is open while it is rendered, which moves no focus by
  // itself; the second try covers a panel shown a frame after it mounts.
  useEffect(() => {
    const focus = () => input.current?.focus();
    focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
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

  return (
    <Popover
      open
      container={popupContainer()}
      onOpenChange={(open, details) => {
        if (open) return;
        if (details.reason === "escape-key") close();
        else onClose();
      }}
    >
      <PopoverContent
        data-popover
        aria-label="Find a decision"
        anchor={caret}
        side="bottom"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        initialFocus="none"
        finalFocus="none"
        style={{ maxHeight: "var(--available-height)" }}
        className={cn(dropdownContentClass, "flex w-80 flex-col gap-0")}
      >
        <Command
          className="flex min-h-0 flex-col"
          // Local decisions are narrowed here and the server's arrive ranked.
          filter={false}
          status={error ? "error" : loading ? "loading" : "idle"}
          onQueryChange={(next) => setQuery(next)}
          onAction={(id) => choose(options.find((o) => o.id === id))}
        >
          <CommandInput
            ref={input}
            aria-label="Find a decision"
            placeholder="Find a decision…"
            onKeyDown={(e) => {
              // Escape leaves the picker at once, even with text typed.
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              close();
            }}
            className="h-10 w-full shrink-0 border-b bg-transparent px-3 text-[13px] outline-none placeholder:text-muted-foreground touch:text-base"
          />
          <CommandList
            aria-label="Decisions"
            render={ownName}
            className="max-h-64 min-h-0 flex-1 overflow-y-auto p-1 outline-none"
          >
            {options.map((option) => (
              <CommandItem
                key={option.id}
                value={option.id}
                label={option.title}
                className={cn(dropdownItemClass, "items-start")}
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
              </CommandItem>
            ))}
          </CommandList>
          <CommandEmpty className="text-[13px] text-muted-foreground data-empty:px-3 data-empty:pb-2.5">
            {error ||
              (loading ? "Searching decisions…" : "No matching decisions")}
          </CommandEmpty>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
