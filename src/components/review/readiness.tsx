"use client";
import { CircleCheck, CircleDashed } from "lucide-react";
import { cn } from "~/lib/utils";
import { SectionLabel } from "~/components/ui/primitives";
import { useItem } from "~/components/items/item-context";

// Evidence, not a percentage: each check states what it verified and, when it
// fails, what would make it pass.
export function Readiness() {
  const { readiness, item } = useItem();
  const checks = readiness?.checks ?? [];
  const passed = checks.filter((c) => c.passed).length;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Readiness</SectionLabel>
        {checks.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              passed === checks.length
                ? "text-emerald-600"
                : "text-muted-foreground",
            )}
          >
            {passed} / {checks.length} checks
          </span>
        )}
      </div>
      {checks.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Evaluating…</p>
      ) : (
        <ul className="space-y-1.5">
          {checks.map((c) => (
            <li
              key={c.key}
              className="flex items-start gap-2 text-[13px] leading-5"
            >
              {c.passed ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              ) : (
                <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className={cn(!c.passed && "text-foreground")}>{c.label}</p>
                {!c.passed && c.detail && (
                  <p className="text-xs text-muted-foreground">{c.detail}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {item.refinementState === "ready"
          ? "All checks pass; this specification is ready for development."
          : "The specification becomes Ready automatically when every check passes."}
      </p>
    </section>
  );
}
