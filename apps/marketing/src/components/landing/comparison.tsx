"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Minus } from "lucide-react";
import {
  comparisonCellText as cellText,
  comparisonProducts as products,
  comparisonRows as rows,
  type ComparisonCell as Cell,
} from "@lictory/marketing/components/landing/content";
import { cn } from "@lictory/core/lib/utils";

// Every row stays in the HTML, so crawlers and AI assistants read the full
// comparison; collapsed rows are only hidden visually.
const differentiatorCount = rows.filter((row) => row.differentiator).length;

function CellValue({ value, highlight }: { value: Cell; highlight?: boolean }) {
  if (value === "yes")
    return (
      <Check
        role="img"
        aria-label={cellText.yes}
        className={cn(
          "size-4",
          highlight ? "text-violet-300" : "text-foreground/70",
        )}
      />
    );
  if (value === "no")
    return (
      <Minus
        role="img"
        aria-label={cellText.no}
        className="size-4 text-white/25"
      />
    );
  return (
    <span className="text-xs text-muted-foreground">
      {value === "partial" ? "Partial" : "—"}
      {value === "n/a" ? <span className="sr-only">Not applicable</span> : null}
    </span>
  );
}

export function ComparisonTable() {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const hiddenCount = rows.length - differentiatorCount;
  const collapsed = (row: (typeof rows)[number]) =>
    !expanded && !row.differentiator;

  return (
    <div id={listId} className="mt-7 max-w-4xl sm:mt-10">
      {/* Tablet and desktop: a compact table. */}
      <div className="hidden overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)] sm:block">
        <table className="w-full text-sm">
          <caption className="sr-only">
            Lictory compared with Jira and Linear
          </caption>
          <thead>
            <tr className="border-b border-white/6 text-[13px]">
              <th
                scope="col"
                className="px-5 py-4 text-left font-medium text-muted-foreground"
              >
                Capability
              </th>
              {products.map(({ key, label }) => (
                <th
                  key={key}
                  scope="col"
                  className={cn(
                    "w-28 px-3 py-4 font-medium lg:w-32",
                    key === "lictory"
                      ? "bg-violet-400/6 text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.map((row) => (
              <tr key={row.feature} hidden={collapsed(row)}>
                <th
                  scope="row"
                  className="px-5 py-3.5 text-left font-normal text-foreground/85"
                >
                  {row.feature}
                </th>
                {products.map(({ key }) => (
                  <td
                    key={key}
                    className={cn(
                      "px-3 py-3.5",
                      key === "lictory" && "bg-violet-400/6",
                    )}
                  >
                    <span className="flex justify-center">
                      <CellValue
                        value={row[key]}
                        highlight={key === "lictory"}
                      />
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones: one card per capability, so nothing scrolls sideways. */}
      <ul
        aria-label="Lictory compared with Jira and Linear"
        className="space-y-2 sm:hidden"
      >
        {rows.map((row) => (
          <li
            key={row.feature}
            hidden={collapsed(row)}
            className="rounded-xl bg-white/2.5 p-4 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.07)]"
          >
            <p className="text-sm font-medium text-foreground/90">
              {row.feature}
            </p>
            <dl className="mt-3 grid grid-cols-3 gap-2">
              {products.map(({ key, label }) => (
                <div
                  key={key}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg py-2",
                    key === "lictory" ? "bg-violet-400/8" : "bg-white/3",
                  )}
                >
                  <dt
                    className={cn(
                      "text-[11px]",
                      key === "lictory"
                        ? "text-violet-200"
                        : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </dt>
                  <dd className="flex h-4 items-center">
                    <CellValue value={row[key]} highlight={key === "lictory"} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-1 text-sm font-medium text-foreground/85 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded
            ? "Show key differences only"
            : `Show full comparison (${hiddenCount} more)`}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 transition-transform duration-200",
              expanded && "rotate-180",
            )}
          />
        </button>
        <p className="max-w-md text-xs leading-5 text-muted-foreground sm:text-right">
          Built-in capabilities as we understand them. Marketplace add-ons and
          integrations may change the picture.
        </p>
      </div>
    </div>
  );
}
