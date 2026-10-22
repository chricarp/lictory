import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { cn } from "@lictory/core/lib/utils";
import { identifier, type Project } from "@lictory/core/lib/work-items";

export function IssueIdentifier({
  project,
  number,
  className,
  copyable = false,
}: {
  project: Project | undefined;
  number: number;
  className?: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const id = identifier(project, number);
  if (!copyable)
    return (
      <span
        className={cn(
          "shrink-0 font-mono text-xs text-muted-foreground tabular-nums",
          className,
        )}
      >
        {id}
      </span>
    );
  return (
    <button
      type="button"
      title="Copy identifier"
      onClick={async () => {
        await navigator.clipboard?.writeText(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cn(
        "group inline-flex h-6 shrink-0 items-center gap-1 rounded px-1 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {id}
      {copied ? (
        <Check className="size-3 text-success" />
      ) : (
        <Copy className="size-3 opacity-0 group-hover:opacity-100" />
      )}
    </button>
  );
}
