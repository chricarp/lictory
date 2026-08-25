"use client";

import type { MomentRecurrence, RecurrenceFreq } from "@lictory/contracts";
import * as React from "react";

import { Field, Input, fieldStyles } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const FREQ_OPTIONS: { value: RecurrenceFreq | "none"; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

/**
 * Structured schedule editing, shared by every surface that can create or
 * correct a moment.
 *
 * The extractor writes a schedule in prose; a human edits it here. Both land in
 * the same structured columns, which is the whole point of parsing recurrence
 * instead of storing the sentence — a birthday the AI inferred and a birthday
 * someone typed are the same row.
 */
export function RecurrenceField({
  value,
  onChange,
}: {
  value: MomentRecurrence | null;
  onChange: (next: MomentRecurrence | null) => void;
}) {
  const freq = value?.freq ?? "none";

  return (
    <div className="flex flex-col gap-3">
      <Field label="Repeats">
        <select
          value={freq}
          onChange={(event) => {
            const next = event.target.value as RecurrenceFreq | "none";
            onChange(
              next === "none"
                ? null
                : {
                    freq: next,
                    interval: value?.interval ?? 1,
                    until: value?.until ?? null,
                  },
            );
          }}
          className={cn(fieldStyles, "h-10")}
        >
          {FREQ_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      {value ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every" hint="1 means every period.">
            <Input
              inputMode="numeric"
              value={String(value.interval)}
              onChange={(event) => {
                const parsed = Number(event.target.value.replace(/\D/g, ""));
                onChange({
                  ...value,
                  interval: Math.min(365, Math.max(1, parsed || 1)),
                });
              }}
            />
          </Field>
          <Field label="Until" hint="Optional end of the series.">
            <Input
              type="date"
              value={value.until?.slice(0, 10) ?? ""}
              onChange={(event) =>
                onChange({ ...value, until: event.target.value || null })
              }
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}
