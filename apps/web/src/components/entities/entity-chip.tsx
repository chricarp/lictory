"use client";

import type { Entity, EntityType, LinkStatus } from "@lictory/contracts";
import { Check, X } from "@/components/ui/icons";
import Link from "next/link";
import * as React from "react";

import { ENTITY_META, entityHref, formatEntityTime } from "@/lib/entities";
import { cn } from "@/lib/utils";

export type EntityChipProps = {
  entity: Pick<Entity, "id" | "name" | "type"> &
    Partial<Pick<Entity, "startsAt" | "allDay" | "address" | "noteCount">>;
  status?: LinkStatus;
  origin?: "ai" | "user";
  size?: "sm" | "md";
  /** Renders as a link into the entity's own page unless disabled. */
  href?: string | null;
  onConfirm?: () => void;
  onReject?: () => void;
  className?: string;
};

/**
 * The single most reused object in the product: every extracted person, place,
 * moment and topic is rendered as a chip that navigates to everything else
 * sharing that context.
 */
export function EntityChip({
  entity,
  status = "confirmed",
  size = "md",
  href,
  onConfirm,
  onReject,
  className,
}: EntityChipProps) {
  const meta = ENTITY_META[entity.type as EntityType];
  const Icon = meta.icon;
  const suggested = status === "suggested";

  const detail =
    entity.type === "time"
      ? formatEntityTime(entity.startsAt ?? null, entity.allDay ?? false)
      : null;

  const body = (
    <>
      <Icon className="shrink-0" />
      <span className="truncate">{entity.name}</span>
      {detail ? (
        <span className="hidden shrink-0 opacity-70 sm:inline">· {detail}</span>
      ) : null}
      {typeof entity.noteCount === "number" && entity.noteCount > 0 ? (
        <span className="shrink-0 rounded-full bg-[rgb(var(--hairline)/0.18)] px-1.5 text-[0.6875rem] font-semibold tabular-nums">
          {entity.noteCount}
        </span>
      ) : null}
    </>
  );

  const shared = cn(
    "group/chip inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium tracking-tight transition-all duration-200",
    size === "sm"
      ? "px-2 py-0.5 text-[0.6875rem] [&_svg]:size-3"
      : "px-2.5 py-1 text-xs [&_svg]:size-3.5",
    meta.chip,
    suggested && "border-dashed",
    className,
  );

  return (
    <span className="inline-flex max-w-full items-center gap-1">
      {href === null ? (
        <span className={shared}>{body}</span>
      ) : (
        <Link
          href={href ?? entityHref(entity.id)}
          className={cn(shared, "hover:brightness-110")}
        >
          {body}
        </Link>
      )}

      {suggested && (onConfirm || onReject) ? (
        <span className="inline-flex items-center gap-0.5">
          {onConfirm ? (
            <button
              type="button"
              onClick={onConfirm}
              aria-label={`Keep ${entity.name}`}
              className="rounded-full border border-hairline-strong p-0.5 text-subtle transition-colors hover:border-[rgb(var(--success)/0.5)] hover:text-success"
            >
              <Check className="size-3" />
            </button>
          ) : null}
          {onReject ? (
            <button
              type="button"
              onClick={onReject}
              aria-label={`Remove ${entity.name}`}
              className="rounded-full border border-hairline-strong p-0.5 text-subtle transition-colors hover:border-[rgb(var(--danger)/0.5)] hover:text-danger"
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
