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
      <ol
        aria-label="From proposal to delivery"
        className="lifecycle grid gap-1.5 rounded-[1.375rem] bg-fd-muted p-1.5 ring-1 ring-fd-border ring-inset sm:grid-cols-5"
      >
        {stages.map((stage, index) => (
          <li
            key={stage.name}
            className="relative rounded-2xl bg-fd-card px-3.5 py-3 shadow-[0_0_0_1px_var(--color-fd-border)]"
          >
            <span className="font-mono text-[10.5px] tracking-[0.08em] text-fd-muted-foreground uppercase">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="mt-2 flex items-center gap-1.5 text-sm font-semibold tracking-[-0.01em]">
              <span
                aria-hidden
                className={
                  index === stages.length - 1
                    ? "size-1.5 rounded-full bg-(--brand)"
                    : "size-1.5 rounded-full bg-fd-foreground/30"
                }
              />
              {stage.name}
            </span>
            <span className="mt-1 block text-xs leading-snug text-fd-muted-foreground">
              {stage.detail}
            </span>
          </li>
        ))}
      </ol>
      <figcaption className="mt-2.5 text-xs text-fd-muted-foreground">
        A specification can return to refinement at any point; history keeps
        every revision and decision.
      </figcaption>
    </figure>
  );
}
