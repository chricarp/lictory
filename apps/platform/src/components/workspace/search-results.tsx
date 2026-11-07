import { useEffect, useId, useMemo, useState } from "react";
import { BadgeCheck, BookOpen, FileText, Loader, Search } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import type {
  KnowledgeKind,
  KnowledgeResult,
} from "@lictory/core/capabilities/product-knowledge";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { EmptyState } from "@lictory/ui/primitives";
import {
  Link,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  Highlighted,
  MIN_CONTENT_QUERY,
} from "@lictory/platform/components/workspace/content-search";

// "See all results" (docs/internals/spaces.md#search-and-product-knowledge):
// everything searchKnowledge finds for a query, beyond the palette's first
// few, filtered by kind and project, a bounded batch at a time. The query
// and filters live in the address (`/{org}/search?q=&kind=&project=`), so a
// result list can be shared and reopened; what was loaded belongs to one
// person, organization and query and is dropped when any of them changes.

const filters = [
  { id: "all", label: "All", kinds: undefined },
  { id: "pages", label: "Pages", kinds: ["page"] },
  {
    id: "specifications",
    label: "Specifications",
    kinds: ["item", "approved", "delivered"],
  },
  { id: "decisions", label: "Decisions", kinds: ["decision"] },
] as const satisfies readonly {
  id: string;
  label: string;
  kinds: readonly KnowledgeKind[] | undefined;
}[];
type FilterId = (typeof filters)[number]["id"];
const ALL_KINDS: KnowledgeKind[] = [
  "page",
  "item",
  "decision",
  "approved",
  "delivered",
];
// Per kind and batch (the capability's bound).
const BATCH = 20;

type Want = { key: string; offset: number; kinds: readonly KnowledgeKind[] };
type Loaded = {
  key: string;
  // The request this answers.
  request: Want;
  results: KnowledgeResult[];
  // Kinds with more results after the request's batch.
  more: KnowledgeKind[];
  status: "done" | "error";
  error?: string;
};

const kindLabel: Record<KnowledgeKind, string> = {
  page: "Page",
  item: "Specification",
  approved: "Approved",
  delivered: "Delivered",
  decision: "Decision",
};

function useSearchResults(
  userId: string,
  organizationId: string,
  query: string,
  kinds: readonly KnowledgeKind[],
  projectId: string | undefined,
) {
  const key = JSON.stringify([userId, organizationId, query, kinds, projectId]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [want, setWant] = useState<Want>({ key, offset: 0, kinds });
  // A new person, organization, query or filter starts again from nothing.
  if (want.key !== key) setWant({ key, offset: 0, kinds });
  const active = query.length >= MIN_CONTENT_QUERY;
  useEffect(() => {
    if (!active || want.key !== key) return;
    let current = true;
    callCapability<{ results: KnowledgeResult[]; more: KnowledgeKind[] }>(
      "searchKnowledge",
      {
        organizationId,
        query,
        kinds: want.kinds,
        limit: BATCH,
        offset: want.offset,
        ...(projectId ? { projectId } : {}),
      },
    ).then(
      ({ results, more }) => {
        if (!current) return;
        setLoaded((prev) => {
          const before =
            want.offset > 0 && prev?.key === key ? prev.results : [];
          // An agreement names that exact revision more precisely than the
          // item it belongs to, whichever batch it arrived in.
          const agreed = new Set(
            [...before, ...results]
              .filter((r) => r.kind === "approved" || r.kind === "delivered")
              .map((r) => r.id),
          );
          const seen = new Set<string>();
          const merged = [...before, ...results].filter((r) => {
            const id = `${r.kind}:${r.id}`;
            if (seen.has(id)) return false;
            seen.add(id);
            return !(
              r.kind === "item" &&
              r.revisionId &&
              agreed.has(r.revisionId)
            );
          });
          return { key, request: want, results: merged, more, status: "done" };
        });
      },
      (error: unknown) => {
        if (!current) return;
        setLoaded((prev) => ({
          key,
          request: want,
          results: prev?.key === key ? prev.results : [],
          more: prev?.key === key ? prev.more : [],
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "The search failed. Try again.",
        }));
      },
    );
    return () => {
      current = false;
    };
  }, [active, key, want, organizationId, query, projectId]);
  const mine = loaded?.key === key ? loaded : null;
  const status = !active
    ? "idle"
    : mine?.request === want
      ? mine.status
      : "loading";
  return {
    results: active ? (mine?.results ?? []) : [],
    status,
    error: mine?.error,
    more: status === "done" && (mine?.more.length ?? 0) > 0,
    loadMore: () => {
      if (!mine?.more.length) return;
      setWant({ key, offset: mine.request.offset + BATCH, kinds: mine.more });
    },
    retry: () => setWant({ ...want }),
  } as const;
}

export function SearchResults() {
  const { organization, userId, projects } = useWorkspace();
  const router = useRouter();
  const params = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const filter: FilterId =
    filters.find((f) => f.id === params.get("kind"))?.id ?? "all";
  const visibleProjects = projects.filter((p) => !p.archivedAt);
  const projectId = visibleProjects.some((p) => p.id === params.get("project"))
    ? (params.get("project") ?? undefined)
    : undefined;
  const kinds = useMemo(
    () => [...(filters.find((f) => f.id === filter)?.kinds ?? ALL_KINDS)],
    [filter],
  );
  const search = useSearchResults(
    userId,
    organization.id,
    query,
    kinds,
    projectId,
  );
  const [draft, setDraft] = useState(query);
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setDraft(query);
  }
  const navigate = (next: {
    q?: string;
    kind?: FilterId;
    project?: string;
  }) => {
    const q = next.q ?? query;
    const kind = next.kind ?? filter;
    const project = next.project ?? projectId ?? "";
    router.replace(
      paths.search(organization.slug, {
        q,
        ...(kind !== "all" ? { kind } : {}),
        ...(project ? { project } : {}),
      }),
    );
  };
  const projectField = useId();
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-semibold">Search</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-5">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ q: draft.trim() });
            }}
            className="flex items-center gap-2 rounded-lg border bg-card px-3 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10"
          >
            <Search
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Search pages, specifications and decisions"
              placeholder="Search pages, specifications and decisions"
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 touch:text-base"
            />
          </form>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div
              role="radiogroup"
              aria-label="Kind"
              className="flex flex-wrap items-center gap-1"
            >
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={filter === f.id}
                  onClick={() => navigate({ kind: f.id })}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    filter === f.id
                      ? "bg-foreground text-background"
                      : "text-muted-foreground ring-1 ring-foreground/10 hover:text-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {visibleProjects.length > 1 && (
              <label
                htmlFor={projectField}
                className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"
              >
                Project
                <select
                  id={projectField}
                  value={projectId ?? ""}
                  onChange={(e) => navigate({ project: e.target.value })}
                  className="h-7 rounded-md border bg-background px-2 text-[13px] text-foreground touch:text-base"
                >
                  <option value="">All projects</option>
                  {visibleProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Finds the words as typed (a phrase, any case) in published pages,
            current specifications, approved or delivered revisions and
            decisions you can read. Titles that match come first, then the most
            recent.
          </p>
          {search.status === "idle" ? (
            <EmptyState
              illustration="search"
              title="Search everything you can read"
            >
              Type at least {MIN_CONTENT_QUERY} characters.
            </EmptyState>
          ) : search.results.length === 0 && search.status === "done" ? (
            <EmptyState
              illustration="search"
              title={`No matches for “${query}”`}
            >
              {filter !== "all" || projectId
                ? "Try all kinds and projects, or fewer words."
                : "Try fewer or different words."}
            </EmptyState>
          ) : (
            <ul
              aria-label={`Results for “${query}”`}
              className="overflow-hidden rounded-lg border"
            >
              {search.results.map((r) => (
                <ResultRow key={`${r.kind}:${r.id}`} result={r} />
              ))}
            </ul>
          )}
          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
          >
            {search.status === "loading" ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader
                  className="size-3.5 motion-safe:animate-spin"
                  aria-hidden
                />
                Searching…
              </span>
            ) : search.status === "error" ? (
              <>
                <span className="text-destructive">
                  Could not search: {search.error}
                </span>
                <Button size="sm" variant="secondary" onClick={search.retry}>
                  Try again
                </Button>
              </>
            ) : search.status === "done" && search.results.length > 0 ? (
              <span>
                {search.results.length}{" "}
                {search.results.length === 1 ? "result" : "results"}
                {search.more ? " so far" : ""}
              </span>
            ) : null}
            {search.more && (
              <Button size="sm" variant="secondary" onClick={search.loadMore}>
                Show more results
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ result: r }: { result: KnowledgeResult }) {
  const where =
    r.kind === "page" ? [r.space.name, ...r.path].join(" / ") : r.key;
  const version =
    r.kind === "page"
      ? `v${r.version}`
      : r.kind === "item"
        ? r.revisionNumber
          ? `revision ${r.revisionNumber}`
          : null
        : `revision ${r.revisionNumber}`;
  const icon =
    r.kind === "page" ? (
      <FileText className="size-4" aria-hidden />
    ) : r.kind === "decision" ? (
      <BookOpen className="size-4" aria-hidden />
    ) : (
      <BadgeCheck className="size-4" aria-hidden />
    );
  return (
    <li className="relative flex items-start gap-3 border-b px-3 py-2.5 text-[13px] last:border-b-0 hover:bg-muted/50">
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <Link
            href={r.href}
            className="min-w-0 truncate font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
          >
            <Highlighted text={r.title} highlights={r.titleHighlights} />
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {kindLabel[r.kind]}
            {version ? ` · ${version}` : ""}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{where}</p>
        {r.snippet.text && (
          <p className="mt-1 line-clamp-2 text-xs leading-[1.45] text-foreground/80">
            <Highlighted
              text={r.snippet.text}
              highlights={r.snippet.highlights}
            />
          </p>
        )}
      </div>
    </li>
  );
}
