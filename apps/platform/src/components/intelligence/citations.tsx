import { Link } from "@lictory/platform/lib/navigation";
import { BookOpen, FileText } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import type { PageEvidence } from "@lictory/platform/components/intelligence/chat/activity";
import {
  scopeLabel,
  type IntelligenceContextUse,
} from "@lictory/core/intelligence/shared";
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

// Pages of Lictory Spaces the assistant read or found, each at the exact
// version it used: the link opens that version (`?commit=`), so people
// check the answer against what was actually read, not today's page.
export function PageCitations({ pages }: { pages: readonly PageEvidence[] }) {
  if (!pages.length) return null;
  return (
    <ul aria-label="Pages used" className="-mx-1 grid">
      {pages.map((p) => {
        const version =
          p.version !== null
            ? `version ${p.version}`
            : p.published === false
              ? "an earlier version"
              : p.published
                ? "published version"
                : null;
        const detail = [
          p.space,
          version,
          p.publishing === "reviewed"
            ? "reviewed"
            : p.publishing === "direct"
              ? "published directly"
              : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const content = (
          <>
            <FileText
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate">{p.title}</span>
            {detail && (
              <span className="ml-auto shrink-0 truncate text-[11px] text-muted-foreground">
                {detail}
              </span>
            )}
          </>
        );
        return (
          <li key={`${p.pageId}@${p.commitId ?? ""}`}>
            {p.href ? (
              <Link
                href={p.href}
                title={version ? `Open ${version} of ${p.title}` : undefined}
                className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/60"
              >
                {content}
              </Link>
            ) : (
              <span className="flex min-w-0 items-center gap-2 px-1 py-0.5">
                {content}
              </span>
            )}
          </li>
        );
      })}
    </ul>
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
