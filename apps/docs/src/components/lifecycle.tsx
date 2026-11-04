import { ChevronRight, CornerLeftUp } from "lucide-react";

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
        {/* The way back: review and readiness can send a revision back. */}
        <p className="border-fd-border text-fd-muted-foreground mt-1.5 flex items-center gap-2 rounded-xl border border-dashed px-3 py-2 text-xs sm:mx-[20%]">
          <CornerLeftUp aria-hidden className="size-3.5 shrink-0" />A material
          change or a requested change returns the specification to refinement;
          earlier approvals become stale.
        </p>
      </div>
      <figcaption className="text-fd-muted-foreground mt-2.5 text-xs">
        History keeps every revision, review and decision along the way.
      </figcaption>
    </figure>
  );
}
