import { useEffect, useRef, useState } from "react";
import { cn } from "@lictory/core/lib/utils";
import { useItem } from "@lictory/platform/components/items/item-context";

// Click the title to edit it. Enter saves, Escape cancels. A title change is
// part of the revision (approvals go stale), so the intent is shown on hover.
export function InlineTitle() {
  const { item, current, mutate, base, canEdit } = useItem();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(item.title);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
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
            void save();
          } else if (e.key === "Escape") {
            setValue(item.title);
            setEditing(false);
          }
        }}
        className="w-full resize-none bg-transparent text-2xl leading-tight font-semibold tracking-tight outline-none"
        style={{ fieldSizing: "content" }}
      />
    );
  return (
    <h1
      className={cn(
        "-mx-1 rounded px-1 text-2xl leading-tight font-semibold tracking-tight",
        canEdit && "cursor-text hover:bg-muted/60",
      )}
      title={canEdit ? "Click to rename (creates a revision)" : undefined}
      onClick={() => {
        if (!canEdit) return;
        setValue(item.title);
        setEditing(true);
      }}
    >
      {item.title}
    </h1>
  );
}
