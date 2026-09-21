"use client";
import { useState } from "react";
import { Check, WandSparkles, X } from "lucide-react";
import { cn } from "~/lib/utils";
import { relativeTime } from "~/lib/work-items";
import { Button } from "~/components/ui/button";
import { Avatar, Badge, SectionLabel } from "~/components/ui/primitives";
import { RevisionDiff } from "~/components/items/diff";
import { useItem } from "~/components/items/item-context";

// Suggestions are actionable text changes, shown as diffs against the revision
// they were written for. Accepting one creates the next revision.
export function Suggestions() {
  const {
    suggestions,
    current,
    revisions,
    mutate,
    base,
    memberName,
    readOnly,
    revisionNumber,
  } = useItem();
  const [showDecided, setShowDecided] = useState(false);
  const pending = suggestions.filter((s) => s.status === "pending");
  const decided = suggestions.filter((s) => s.status !== "pending");
  if (suggestions.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Suggestions</SectionLabel>
        <span className="text-xs text-muted-foreground tabular-nums">
          {pending.length} pending
        </span>
        {decided.length > 0 && (
          <button
            onClick={() => setShowDecided((v) => !v)}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            {showDecided ? "Hide" : "Show"} {decided.length} decided
          </button>
        )}
      </div>
      <div className="space-y-3">
        {[...pending, ...(showDecided ? decided : [])].map((s) => {
          const target = revisions.find((r) => r.id === s.revisionId);
          const outdated =
            s.status === "pending" && current && s.revisionId !== current.id;
          return (
            <article
              key={s.id}
              className={cn(
                "rounded-md border",
                s.status !== "pending" && "opacity-75",
              )}
            >
              <header className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                <WandSparkles className="size-3.5 text-primary" />
                <Avatar name={memberName(s.authorId)} size="xs" />
                <span className="font-medium text-foreground">
                  {memberName(s.authorId)}
                </span>
                <time>{relativeTime(s.createdAt)}</time>
                <span>· against revision {target?.number ?? "?"}</span>
                <span className="ml-auto">
                  {s.status === "accepted" ? (
                    <Badge tone="good">
                      <Check className="size-3" /> Accepted as revision{" "}
                      {revisionNumber(s.acceptedRevisionId ?? "") ?? ""}
                    </Badge>
                  ) : s.status === "rejected" ? (
                    <Badge>
                      <X className="size-3" /> Rejected
                    </Badge>
                  ) : outdated ? (
                    <Badge tone="warning">
                      Outdated · revision {current?.number} is current
                    </Badge>
                  ) : (
                    <Badge tone="info">Pending</Badge>
                  )}
                </span>
              </header>
              {s.rationale && (
                <p className="px-3 pt-2 text-[13px]">{s.rationale}</p>
              )}
              <div className="p-3">
                <RevisionDiff
                  before={target?.content ?? ""}
                  after={s.replacement}
                />
              </div>
              {s.status === "pending" && !readOnly && (
                <footer className="flex items-center gap-1 border-t px-2 py-1.5">
                  <Button
                    size="sm"
                    disabled={Boolean(outdated)}
                    title={
                      outdated
                        ? "The specification moved on; ask for an updated suggestion."
                        : undefined
                    }
                    onClick={() =>
                      void mutate({
                        type: "decideSuggestion",
                        ...base,
                        suggestionId: s.id,
                        accept: true,
                      })
                    }
                  >
                    <Check className="size-3.5" /> Accept suggestion
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void mutate({
                        type: "decideSuggestion",
                        ...base,
                        suggestionId: s.id,
                        accept: false,
                      })
                    }
                  >
                    Reject
                  </Button>
                </footer>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
