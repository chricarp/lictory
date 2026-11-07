import { FileText } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Link } from "@lictory/platform/lib/navigation";
import { knowledgeAnchor } from "@lictory/platform/components/knowledge/anchor";

// "2 pages": readable pages that mention an item or are attached to it,
// linking to the item's Knowledge section. Absent at zero (and never
// counting pages the reader cannot read).
export function PageCount({
  count,
  itemHref,
  className,
  long = false,
}: {
  count: number | undefined;
  itemHref: string;
  className?: string;
  // "2 pages about this item" instead of the number alone.
  long?: boolean;
}) {
  if (!count) return null;
  const label = `${count} ${count === 1 ? "page" : "pages"}`;
  return (
    <Link
      href={`${itemHref.split("#")[0]}#${knowledgeAnchor}`}
      title={`${label} about this item`}
      aria-label={long ? undefined : `${label} about this item`}
      className={cn(
        "relative z-10 inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 text-[11px] text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <FileText className="size-3" aria-hidden />
      {long ? `${label} about this item` : count}
    </Link>
  );
}
