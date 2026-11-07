import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  BadgeCheck,
  BookOpen,
  FileText,
  Loader,
  ScrollText,
  Search,
} from "lucide-react";
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
  StaleNotice,
} from "@lictory/platform/components/workspace/content-search";
import {
  useSearchFreshness,
  useVisibleRefresh,
} from "@lictory/platform/components/workspace/search-freshness";
import {
  nextRequest as after,
  refreshBatches,
  type SearchAnswer as Answer,
  type SearchRequest as Request,
} from "@lictory/platform/components/workspace/search-batches";

// "See all results" (docs/internals/spaces.md#search-and-product-knowledge):
// everything searchKnowledge finds for a query, beyond the palette's first
// few, filtered by kind and project, a bounded batch at a time (each batch
// continues after the previous one's position, so results added meanwhile
// never repeat). The query and filters live in the address
// (`/{org}/search?q=&kind=&project=`), so a result list can be shared and
// reopened; what was loaded belongs to one person, organization and query
// and is dropped when any of them changes. Every loaded batch is read again,
// from the beginning (search-batches.ts), when synchronized access,
// publication or item state changes and at a bounded interval while visible
// (search-freshness.ts); when that fails the results stay, marked as not
// checked since they were last read, with Retry.

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

type Loaded = {
  key: string;
  // The batches asked for, in order, and the answers that arrived (as many
  // as there are requests once nothing is loading).
  requests: Request[];
  answers: Answer[];
  error?: string;
  // What the synchronized rows said about the results when they were read.
  facts: string;
  // When the answers were last read, and whether reading them again failed
  // since: they stay on screen, said to be unchecked, until a read succeeds.
  checkedAt?: number;
  stale?: true;
};

const fetchBatch = (
  organizationId: string,
  query: string,
  projectId: string | undefined,
  request: Request,
) =>
  callCapability<Answer>("searchKnowledge", {
    organizationId,
    query,
    kinds: request.kinds,
    limit: BATCH,
    ...(request.cursor ? { cursor: request.cursor } : {}),
    ...(projectId ? { projectId } : {}),
  });

// Every batch in order, each result once. An agreement names that exact
// revision more precisely than the item it belongs to, whichever batch it
// arrived in.
function merge(answers: readonly Answer[]) {
  const all = answers.flatMap((a) => a.results);
  const agreed = new Set(
    all
      .filter((r) => r.kind === "approved" || r.kind === "delivered")
      .map((r) => r.id),
  );
  const seen = new Set<string>();
  return all.filter((r) => {
    const id = `${r.kind}:${r.id}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return !(r.kind === "item" && r.revisionId && agreed.has(r.revisionId));
  });
}

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
  const active = query.length >= MIN_CONTENT_QUERY;
  const fresh = useSearchFreshness();
  const factsOf = useRef(fresh.facts);
  useEffect(() => {
    factsOf.current = fresh.facts;
  });
  const [loaded, setLoaded] = useState<Loaded>(() => ({
    key,
    requests: [{ cursor: null, kinds }],
    answers: [],
    facts: "",
  }));
  // A new person, organization, query or filter starts again from nothing.
  const mine = useMemo<Loaded>(
    () =>
      loaded.key === key
        ? loaded
        : { key, requests: [{ cursor: null, kinds }], answers: [], facts: "" },
    [loaded, key, kinds],
  );
  if (mine !== loaded) setLoaded(mine);
  const waiting = mine.answers.length < mine.requests.length;
  const nextRequest =
    waiting && !mine.error ? mine.requests[mine.answers.length] : null;

  // The batch asked for and not answered yet.
  useEffect(() => {
    if (!active || !nextRequest) return;
    let current = true;
    fetchBatch(organizationId, query, projectId, nextRequest).then(
      (answer) => {
        if (!current) return;
        setLoaded((prev) => {
          if (
            prev.key !== key ||
            prev.requests[prev.answers.length] !== nextRequest
          )
            return prev;
          const answers = [...prev.answers, answer];
          return {
            ...prev,
            answers,
            error: undefined,
            facts: factsOf.current(merge(answers)),
            checkedAt: Date.now(),
            stale: undefined,
          };
        });
      },
      (error: unknown) => {
        if (!current) return;
        setLoaded((prev) =>
          prev.key !== key
            ? prev
            : {
                ...prev,
                error:
                  error instanceof Error
                    ? error.message
                    : "The search failed. Try again.",
              },
        );
      },
    );
    return () => {
      current = false;
    };
  }, [active, key, nextRequest, organizationId, query, projectId]);

  // Every loaded batch again, in order from the beginning, each continuing
  // after the newly read one (search-batches.ts). What it no longer finds
  // leaves; a failure keeps what is shown, marked as not checked (the next
  // refresh, or Retry, reads again).
  const refreshing = useRef<Request[] | null>(null);
  const refresh = useCallback(() => {
    if (!active || waiting || mine.error) return;
    const requests = mine.requests;
    if (refreshing.current === requests) return;
    refreshing.current = requests;
    void refreshBatches(requests[0]!, requests.length, (r) =>
      fetchBatch(organizationId, query, projectId, r),
    )
      .then(
        (read) =>
          setLoaded((prev) =>
            prev.key !== key || prev.requests !== requests
              ? prev
              : {
                  ...prev,
                  ...read,
                  facts: factsOf.current(merge(read.answers)),
                  checkedAt: Date.now(),
                  stale: undefined,
                },
          ),
        () =>
          setLoaded((prev) =>
            prev.key !== key || prev.requests !== requests
              ? prev
              : {
                  ...prev,
                  stale: true,
                  // Not again at once for the same change: the interval,
                  // focus or Retry reads again.
                  facts: factsOf.current(merge(prev.answers)),
                },
          ),
      )
      .finally(() => {
        if (refreshing.current === requests) refreshing.current = null;
      });
  }, [active, waiting, mine, key, organizationId, query, projectId]);

  const merged = useMemo(() => merge(mine.answers), [mine.answers]);
  // Synchronized rows changed what they say about these results: read them
  // again (shortly, so a burst of changes is one read).
  const facts = fresh.facts(merged);
  const changed = !waiting && mine.answers.length > 0 && facts !== mine.facts;
  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(refresh, 300);
    return () => clearTimeout(timer);
  }, [changed, facts, refresh]);
  useVisibleRefresh(refresh, active && !waiting);
  const visibleResults = useMemo(
    () => (active ? fresh.visible(merged) : []),
    [active, fresh, merged],
  );

  const last = mine.answers.at(-1);
  const status = !active
    ? "idle"
    : mine.error
      ? "error"
      : waiting
        ? "loading"
        : "done";
  return {
    results: visibleResults,
    status,
    error: mine.error,
    more: status === "done" && Boolean(last && after(last)),
    // Shown results that could not be checked again, and since when.
    stale:
      status === "done" && mine.stale && mine.checkedAt
        ? { checkedAt: mine.checkedAt, retry: refresh }
        : null,
    loadMore: () => {
      const next = last && after(last);
      if (!next) return;
      setLoaded({ ...mine, requests: [...mine.requests, next] });
    },
    retry: () => setLoaded({ ...mine, error: undefined }),
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
            {search.stale && (
              <StaleNotice
                checkedAt={search.stale.checkedAt}
                onRetry={search.stale.retry}
              />
            )}
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
  // The seal is for agreements only (approved or delivered revisions); a
  // specification as it is now carries no approval.
  const icon =
    r.kind === "page" ? (
      <FileText className="size-4" aria-hidden />
    ) : r.kind === "decision" ? (
      <BookOpen className="size-4" aria-hidden />
    ) : r.kind === "item" ? (
      <ScrollText className="size-4" aria-hidden />
    ) : (
      <BadgeCheck className="size-4" aria-hidden />
    );
  return (
    <li className="relative flex items-start gap-3 border-b px-3 py-2.5 text-[13px] last:border-b-0 hover:bg-muted/50">
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {/* A long title wraps (two lines at most, so names that differ only
            at the end stay apart on phones) and the kind and version move
            to their own line when they no longer fit beside it. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <Link
            href={r.href}
            className="line-clamp-2 min-w-0 font-medium break-words outline-none after:absolute after:inset-0 focus-visible:underline"
          >
            <Highlighted text={r.title} highlights={r.titleHighlights} />
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground">
            {kindLabel[r.kind]}
            {version ? ` · ${version}` : ""}
          </span>
        </div>
        <p className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{where}</span>
          {r.kind !== "page" && r.kind !== "item" && (
            // The title opens the revision this result is about; this opens
            // the item as it is now.
            <Link
              href={r.currentHref}
              aria-label={`Open ${r.key} as it is now`}
              className="relative z-10 shrink-0 rounded-sm underline decoration-foreground/30 underline-offset-2 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Open current
            </Link>
          )}
        </p>
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
