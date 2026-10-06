"use client";
import { cn } from "~/lib/utils";

type Branded = {
  name: string;
  logos?: { mark: string | null; full: string | null };
};

// The organization's square logomark, falling back to its initial.
export function OrganizationMark({
  organization,
  className,
}: {
  organization: Branded;
  className?: string;
}) {
  const mark = organization.logos?.mark;
  if (mark)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- private, authenticated image
      <img
        src={mark}
        alt=""
        aria-hidden
        className={cn("size-5 shrink-0 rounded object-contain", className)}
      />
    );
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground",
        className,
      )}
    >
      {organization.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
