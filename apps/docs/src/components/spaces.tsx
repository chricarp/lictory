import { ChevronRight, ChevronUp, CornerLeftUp, Lock } from "lucide-react";

// Diagrams of Lictory Spaces in the documentation's tray and card language
// (see Lifecycle): real text in ordered lists, so they read the same aloud,
// in either theme and at phone width.

type Stage = { name: string; detail: string };

const columns: Record<number, string> = {
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
};

// A path of stages, the last one marked as the result, with an optional way
// back drawn from one stage to an earlier one.
function Flow({
  label,
  stages,
  back,
  caption,
}: {
  label: string;
  stages: readonly Stage[];
  back?: { from: number; to: number; title: string; detail: string };
  caption: string;
}) {
  const center = (index: number) => ((index + 0.5) / stages.length) * 100;
  return (
    <figure className="not-prose my-8">
      <div className="bg-fd-muted ring-fd-border rounded-[1.375rem] p-1.5 ring-1 ring-inset">
        <ol
          aria-label={label}
          className={`grid gap-1.5 ${columns[stages.length] ?? ""}`}
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
        {back && (
          <>
            <div aria-hidden className="relative hidden h-9 sm:block">
              <svg
                className="text-fd-foreground/55 absolute inset-0 size-full overflow-visible"
                viewBox="0 0 100 36"
                preserveAspectRatio="none"
              >
                <path
                  d={`M${center(back.from)} 0 V16 Q${center(back.from)} 22 ${center(back.from) - 6} 22 H${center(back.to) + 6} Q${center(back.to)} 22 ${center(back.to)} 16 V4`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span
                className="bg-fd-card text-fd-muted-foreground absolute top-0 grid size-4 -translate-x-1/2 -translate-y-0.5 place-items-center rounded-full shadow-[0_0_0_1px_var(--color-fd-border)]"
                style={{ left: `${center(back.to)}%` }}
              >
                <ChevronUp className="size-3" />
              </span>
            </div>
            <p className="flex items-start gap-2 px-3 pt-2 pb-2 text-[13px] leading-snug sm:justify-center sm:pt-1 sm:text-center">
              <CornerLeftUp
                aria-hidden
                className="text-fd-muted-foreground mt-0.5 size-3.5 shrink-0 sm:hidden"
              />
              <span>
                <span className="text-fd-foreground block font-medium">
                  {back.title}
                </span>
                <span className="text-fd-muted-foreground block">
                  {back.detail}
                </span>
              </span>
            </p>
          </>
        )}
      </div>
      <figcaption className="text-fd-muted-foreground mt-2.5 text-xs">
        {caption}
      </figcaption>
    </figure>
  );
}

// How a page changes in a Direct space: straight from the live draft.
export function DirectPublishing() {
  return (
    <Flow
      label="Publishing in a Direct space"
      stages={[
        {
          name: "Live draft",
          detail: "Editors write together; every edit is stored as they type",
        },
        {
          name: "Publish",
          detail: "Seals exactly what is saved, with an optional message",
        },
        {
          name: "Published version",
          detail: "What readers see; earlier versions stay in history",
        },
      ]}
      caption="Typing after Publish stays an unpublished change until the next Publish."
    />
  );
}

// How a page changes through review: branch, commit, pull request, merge.
export function ReviewedChange() {
  return (
    <Flow
      label="From a branch to a published version"
      stages={[
        {
          name: "Branch",
          detail: "Its own live draft, for its author and collaborators",
        },
        {
          name: "Commit",
          detail: "Seals what is saved as a version of the branch",
        },
        {
          name: "Pull request",
          detail: "Proposes the branch's result for the published page",
        },
        {
          name: "Review",
          detail: "Approvals bind to this exact result",
        },
        {
          name: "Merge",
          detail: "Publishes the result as a new version",
        },
      ]}
      back={{
        from: 3,
        to: 0,
        title:
          "Changes requested, new commits or a conflict → back to the branch",
        detail:
          "Approvals of an earlier result go stale and are asked for again.",
      }}
      caption="Branches and pull requests work in Direct spaces too; in Reviewed spaces they are the only way to publish."
    />
  );
}

// Who can open and edit a space, by its location and access mode.
const locations: { name: string; edit: string; view: string | null }[] = [
  {
    name: "Organization",
    edit: "Everyone in the organization",
    view: null,
  },
  {
    name: "Project",
    edit: "Members of the project",
    view: "Everyone else in the organization",
  },
  {
    name: "Team",
    edit: "Members of the team",
    view: "Everyone else in the organization",
  },
];

export function SpaceAccess() {
  return (
    <figure className="not-prose my-8">
      <div className="bg-fd-muted ring-fd-border rounded-[1.375rem] p-1.5 ring-1 ring-inset">
        <p className="text-fd-muted-foreground px-2.5 pt-1.5 pb-2 font-mono text-[10.5px] tracking-[0.08em] uppercase">
          Inherited · access follows the location
        </p>
        <ul
          aria-label="Inherited access by location"
          className="grid gap-1.5 sm:grid-cols-3"
        >
          {locations.map((location) => (
            <li
              key={location.name}
              className="bg-fd-card rounded-2xl px-3.5 py-3 shadow-[0_0_0_1px_var(--color-fd-border)]"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold tracking-[-0.01em]">
                <span
                  aria-hidden
                  className="bg-fd-foreground/30 size-1.5 rounded-full"
                />
                {location.name}
              </span>
              <dl className="mt-2 grid gap-1.5 text-xs leading-snug">
                <div>
                  <dt className="text-fd-muted-foreground font-mono text-[10.5px] tracking-[0.08em] uppercase">
                    Can edit
                  </dt>
                  <dd>{location.edit}</dd>
                </div>
                {location.view && (
                  <div>
                    <dt className="text-fd-muted-foreground font-mono text-[10.5px] tracking-[0.08em] uppercase">
                      Can view
                    </dt>
                    <dd>{location.view}</dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
        <p className="text-fd-muted-foreground px-2.5 pt-3 pb-2 font-mono text-[10.5px] tracking-[0.08em] uppercase">
          Restricted · any location
        </p>
        <div className="bg-fd-card flex items-start gap-2.5 rounded-2xl px-3.5 py-3 shadow-[0_0_0_1px_var(--color-fd-border)]">
          <Lock
            aria-hidden
            className="text-fd-muted-foreground mt-0.5 size-3.5 shrink-0"
          />
          <p className="text-xs leading-snug">
            <span className="block text-sm font-semibold tracking-[-0.01em]">
              Only people with named access
            </span>
            <span className="text-fd-muted-foreground">
              Each named person can view, comment or edit. Membership of the
              location no longer counts.
            </span>
          </p>
        </div>
      </div>
      <figcaption className="text-fd-muted-foreground mt-2.5 text-xs">
        In an Inherited space, named access only adds to what the location
        gives. Pages have no access of their own.
      </figcaption>
    </figure>
  );
}
