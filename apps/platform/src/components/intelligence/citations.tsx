import { Link } from "@lictory/platform/lib/navigation";
import { BookOpen } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { scopeLabel, type IntelligenceContextUse } from "@lictory/core/intelligence/shared";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Where a citation points: the settings page that manages its scope.
function useContextHref() {
  const { organization } = useWorkspace();
  return (use: IntelligenceContextUse) =>
    `${paths.settings(organization.slug)}?context=${encodeURIComponent(use.entryId)}#intelligence-context`;
}

const label = (use: IntelligenceContextUse) =>
  use.scope === "organization" ? use.title : `${use.scopeName} › ${use.title}`;

// The entries a finding relied on. Citations let people check Lictory
// Intelligence against the knowledge it used instead of taking its word for it.
export function ContextCitations({
  context,
}: {
  context: IntelligenceContextUse[];
}) {
  const href = useContextHref();
  if (!context.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
      <BookOpen aria-hidden className="size-3.5 shrink-0" />
      <span>Based on</span>
      {context.map((c, i) => (
        <span key={c.entryId}>
          <Link
            href={href(c)}
            className="font-medium text-foreground/80 hover:underline"
            title={`${scopeLabel[c.scope]} context · version ${c.version}`}
          >
            {label(c)}
          </Link>
          {i < context.length - 1 && ","}
        </span>
      ))}
    </p>
  );
}

// What the model was told for a run, version by version.
export function GroundedIn({ context }: { context: IntelligenceContextUse[] }) {
  const href = useContextHref();
  if (!context.length) return null;
  return (
    <details className="group rounded-md border bg-muted/20 px-3 py-2 text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
        <BookOpen aria-hidden className="size-3.5" />
        Grounded in {context.length} Lictory Intelligence Context{" "}
        {context.length === 1 ? "entry" : "entries"}
      </summary>
      <ul className="mt-2 space-y-1">
        {context.map((c) => (
          <li key={c.entryId} className="flex items-baseline gap-2">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">
              {scopeLabel[c.scope]}
            </span>
            <Link href={href(c)} className="min-w-0 truncate hover:underline">
              {label(c)}
            </Link>
            <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              v{c.version}
              {c.truncated && " · partly included"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
