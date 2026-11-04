import { useEffect, useRef, useState } from "react";
import { useItem } from "@lictory/platform/components/items/item-context";

// Click or activate the title to edit it. Enter saves, Escape cancels. A title
// change is part of the revision (approvals go stale), so the intent is shown
// on hover.
export function InlineTitle() {
  const { item, current, mutate, base, canEdit } = useItem();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  // Enter and Escape return focus to the title; leaving by blur keeps it where
  // the person moved it.
  const refocus = useRef(false);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      button.current?.focus();
    }
  }, [editing]);
  const save = async () => {
    const title = value.trim();
    setEditing(false);
    if (!title || title === item.title || !current) return;
    await mutate({
      type: "updateSpecification",
      ...base,
      title,
      content: current.content,
      summary: "Renamed",
    });
  };
  if (editing)
    return (
      <textarea
        ref={ref}
        value={value}
        rows={1}
        aria-label="Title"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            refocus.current = true;
            void save();
          } else if (e.key === "Escape") {
            refocus.current = true;
            setValue(item.title);
            setEditing(false);
          }
        }}
        className="w-full resize-none bg-transparent text-[1.75rem] leading-[1.2] font-semibold tracking-[-0.03em] outline-none"
        style={{ fieldSizing: "content" }}
      />
    );
  // The heading keeps its role and name; people who may rename it get a
  // button inside, so keyboard and screen reader users can start editing too.
  return (
    <h1 className="text-[1.75rem] leading-[1.2] font-semibold tracking-[-0.03em] text-balance">
      {canEdit ? (
        <button
          ref={button}
          type="button"
          className="-mx-1 block w-[calc(100%+0.5rem)] cursor-text rounded px-1 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60"
          title="Click to rename (creates a revision)"
          onClick={() => {
            setValue(item.title);
            setEditing(true);
          }}
        >
          {item.title}
        </button>
      ) : (
        item.title
      )}
    </h1>
  );
}
