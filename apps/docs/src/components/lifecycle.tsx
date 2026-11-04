import { ChevronRight, ChevronUp, CornerLeftUp } from "lucide-react";

// The refinement-to-delivery path at a glance, in the product's own tray and
// card language: each stage names what has to be true before the next one.
const stages = [
  {
    name: "Proposal",
    detail: "Rough intent, notes and links",
  },
  {
    name: "Refinement",
    detail: "Revisions, discussions, suggestions",
  },
  {
    name: "Review",
    detail: "Each discipline approves a revision",
  },
  {
    name: "Ready",
    detail: "Every readiness check passes",
  },
  {
    name: "Delivery",
    detail: "In Lictory or handed off to Jira",
  },
];

export function Lifecycle() {
  return (
    <figure className="not-prose my-8">
      <div className="bg-fd-muted ring-fd-border rounded-[1.375rem] p-1.5 ring-1 ring-inset">
        <ol
          aria-label="From proposal to delivery"
          className="grid gap-1.5 sm:grid-cols-5"
        >
          {stages.map((stage, index) => (
            <li
              key={stage.name}
              className="bg-fd-card relative rounded-2xl px-3.5 py-3 shadow-[0_0_0_1px_var(--color-fd-border)]"
            >
              <span className="text-fd-muted-foreground font-mono text-[10.5px] tracking-[0.08em] uppercase">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="mt-2 flex items-center gap-1.5 text-sm font-semibold tracking-[-0.01em]">
                <span
                  aria-hidden
                  className={
                    index === stages.length - 1
                      ? "size-1.5 rounded-full bg-(--brand)"
                      : "bg-fd-foreground/30 size-1.5 rounded-full"
                  }
                />
                {stage.name}
              </span>
              <span className="text-fd-muted-foreground mt-1 block text-xs leading-snug">
                {stage.detail}
              </span>
              {index < stages.length - 1 && (
                // The direction of travel, on the seam between two stages.
                <span
                  aria-hidden
                  className="bg-fd-card text-fd-muted-foreground absolute top-1/2 -right-[11px] z-10 hidden size-5 -translate-y-1/2 place-items-center rounded-full shadow-[0_0_0_1px_var(--color-fd-border)] sm:grid"
                >
                  <ChevronRight className="size-3" />
                </span>
              )}
            </li>
          ))}
        </ol>
        {/* The way back: a drawn route from Review and Ready up into
            Refinement, with its reason alongside. */}
        <div aria-hidden className="relative hidden h-9 sm:block">
          <svg
            className="text-fd-muted-foreground/70 absolute inset-0 size-full overflow-visible"
            viewBox="0 0 100 36"
            preserveAspectRatio="none"
          >
            <path
              d="M70 0 V16 Q70 22 64 22 H36 Q30 22 30 16 V4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M50 0 V22"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <span className="bg-fd-card text-fd-muted-foreground absolute top-0 left-[30%] grid size-4 -translate-x-1/2 -translate-y-0.5 place-items-center rounded-full shadow-[0_0_0_1px_var(--color-fd-border)]">
            <ChevronUp className="size-3" />
          </span>
        </div>
        <p className="text-fd-muted-foreground flex items-center gap-2 px-3 pt-1 pb-1.5 text-xs sm:justify-center">
          <CornerLeftUp aria-hidden className="size-3.5 shrink-0 sm:hidden" />A
          requested change or a material edit sends the specification back to
          refinement; earlier approvals become stale.
        </p>
      </div>
      <figcaption className="text-fd-muted-foreground mt-2.5 text-xs">
        History keeps every revision, review and decision along the way.
      </figcaption>
    </figure>
  );
}
