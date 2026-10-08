"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Archive,
  BookOpen,
  FileText,
  History,
  Loader2,
  NotebookPen,
  RotateCcw,
  Upload,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { relativeTime } from "~/lib/work-items";
import {
  ACCEPT_CONTEXT_DOCUMENTS,
  CONTEXT_PROMPT_BUDGET,
  MAX_CONTEXT_CONTENT,
  MAX_CONTEXT_DOCUMENT_SIZE,
  MAX_CONTEXT_TITLE,
  scopeLabel,
  type ContextEntrySummary,
  type ContextTarget,
  type ContextVersionSummary,
} from "~/intelligence/shared";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/primitives";
import { StateIllustration } from "~/components/ui/state-illustration";
import { MarkdownEditor } from "~/components/ui/markdown-editor";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "~/components/ui/dropdown-select";
import { Markdown } from "~/components/items/markdown";
import { useWorkspace } from "~/components/workspace/provider";
import {
  InlineError,
  SettingsList,
  SettingsSection,
} from "~/components/workspace/settings-section";

type Listing = { canManage: boolean; entries: ContextEntrySummary[] };

const targetKey = (t: ContextTarget) =>
  t.scope === "organization"
    ? "organization"
    : t.scope === "project"
      ? `project:${t.projectId}`
      : `team:${t.teamId}`;
const targetOf = (key: string): ContextTarget => {
  const [scope, id] = key.split(":");
  return scope === "project"
    ? { scope: "project", projectId: id! }
    : scope === "team"
      ? { scope: "team", teamId: id! }
      : { scope: "organization" };
};
const entryTarget = (e: ContextEntrySummary): ContextTarget =>
  e.scope === "project"
    ? { scope: "project", projectId: e.projectId! }
    : e.scope === "team"
      ? { scope: "team", teamId: e.teamId! }
      : { scope: "organization" };
const inTarget = (e: ContextEntrySummary, t: ContextTarget) =>
  targetKey(entryTarget(e)) === targetKey(t);
const chars = (n: number) => n.toLocaleString("en-US");

function useContextApi() {
  const { organization } = useWorkspace();
  const base = `/api/organizations/${encodeURIComponent(organization.id)}/intelligence-context`;
  const [listing, setListing] = useState<Listing>();
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(base, { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as Listing & {
      error?: string;
    };
    if (!response.ok)
      throw new Error(
        body.error ?? "Lictory Intelligence Context could not be loaded.",
      );
    return body;
  }, [base]);
  const reload = useCallback(
    () =>
      load()
        .then((l) => {
          setListing(l);
          setLoadError("");
        })
        .catch((e: unknown) =>
          setLoadError(
            e instanceof Error
              ? e.message
              : "Lictory Intelligence Context could not be loaded.",
          ),
        ),
    [load],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  const send = async (fields: Record<string, string | File | undefined>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields))
      if (v !== undefined) form.append(k, v);
    const response = await fetch(base, { method: "POST", body: form });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok)
      throw new Error(body?.error ?? "The change was not saved.");
    await reload();
  };
  const history = async (entryId: string) => {
    const response = await fetch(`${base}/${encodeURIComponent(entryId)}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as {
      versions?: ContextVersionSummary[];
      error?: string;
    };
    if (!response.ok || !body.versions)
      throw new Error(body.error ?? "History could not be loaded.");
    return body.versions;
  };
  return { listing, loadError, send, history };
}

// Lictory Intelligence Context: knowledge administrators give Lictory AI.
// On the organization page the scope can be switched between the
// organization, any project and any team; team settings pin it to the team.
export function IntelligenceContextSection({
  team,
}: {
  team?: { id: string; name: string };
}) {
  const { projects, delivery, directory } = useWorkspace();
  const api = useContextApi();
  const params = useSearchParams();
  const linked = params.get("context");
  const teams = [...delivery.teams.values()].filter((t) => !t.archivedAt);
  const [chosen, setChosen] = useState<string>();
  const linkedEntry = api.listing?.entries.find((e) => e.id === linked);
  const key =
    chosen ??
    (team
      ? `team:${team.id}`
      : linkedEntry
        ? targetKey(entryTarget(linkedEntry))
        : "organization");
  const target = targetOf(key);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState<"note" | "document" | null>(null);
  const entries = (api.listing?.entries ?? []).filter((e) =>
    inTarget(e, target),
  );
  const active = entries.filter((e) => !e.archivedAt);
  const archived = entries.filter((e) => e.archivedAt);
  const used = active.reduce((n, e) => n + e.current.content.length, 0);
  const canManage = api.listing?.canManage ?? false;
  const nameOf = (id: string) =>
    directory.members.find((m) => m.id === id)?.name ?? "Former member";
  const inherited = team
    ? (api.listing?.entries ?? []).filter(
        (e) => e.scope === "organization" && !e.archivedAt,
      ).length
    : 0;

  return (
    <SettingsSection
      id="intelligence-context"
      icon={<BookOpen />}
      title="Lictory Intelligence Context"
      description={
        team
          ? `What Lictory AI should know about how ${team.name} works: conventions, quality standards, constraints. It is added to every AI review of this team's work, on top of organization and project context.`
          : "What Lictory AI should know about your organization, projects and teams: product facts, vocabulary, conventions, policies. Context compounds: work in a team of a project gets all three, and the narrower scope wins when they disagree."
      }
      action={
        canManage && !adding ? (
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAdding("note")}
            >
              <NotebookPen className="size-3.5" /> Write note
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAdding("document")}
            >
              <Upload className="size-3.5" /> Upload document
            </Button>
          </div>
        ) : undefined
      }
      footer={
        <>
          Every member can read this context; only administrators can change it.
          Each change is kept as a version, and AI findings cite the entries
          they relied on. Up to {chars(CONTEXT_PROMPT_BUDGET)} characters reach
          the AI per review, team context first, then project, then
          organization. Context is sent to the AI provider only while Lictory AI
          is enabled.
        </>
      }
    >
      {!team && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
          <label
            htmlFor="intelligence-context-scope"
            className="text-[13px] text-muted-foreground"
          >
            Scope
          </label>
          <DropdownSelect
            id="intelligence-context-scope"
            aria-label="Context scope"
            className="w-64"
            value={key}
            onValueChange={(v) => {
              setChosen(v);
              setAdding(null);
            }}
          >
            <DropdownSelectOption value="organization">
              Organization
            </DropdownSelectOption>
            {projects.map((p) => (
              <DropdownSelectOption key={p.id} value={`project:${p.id}`}>
                Project · {p.name}
              </DropdownSelectOption>
            ))}
            {teams.map((t) => (
              <DropdownSelectOption key={t.id} value={`team:${t.id}`}>
                Team · {t.name}
              </DropdownSelectOption>
            ))}
          </DropdownSelect>
          <BudgetMeter used={used} />
        </div>
      )}
      {team && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 text-[13px] text-muted-foreground">
          <span>
            Also applies: {inherited} organization{" "}
            {inherited === 1 ? "entry" : "entries"} and the context of each
            item&apos;s project.
          </span>
          <BudgetMeter used={used} />
        </div>
      )}
      {adding && (
        <ContextForm
          kind={adding}
          onCancel={() => setAdding(null)}
          onSubmit={async (fields) => {
            await api.send({
              action: "create",
              scope: target.scope,
              projectId:
                target.scope === "project" ? target.projectId : undefined,
              teamId: target.scope === "team" ? target.teamId : undefined,
              ...fields,
            });
            setAdding(null);
          }}
        />
      )}
      {api.loadError ? (
        <p role="alert" className="px-5 py-6 text-[13px] text-destructive">
          {api.loadError}
        </p>
      ) : !api.listing ? (
        <p className="flex items-center gap-2 px-5 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          Loading context…
        </p>
      ) : (
        <SettingsList
          isEmpty={active.length === 0 && (!showArchived || !archived.length)}
          empty={
            <>
              <StateIllustration kind="knowledge" />
              {canManage
                ? `No ${scopeLabel[target.scope].toLowerCase()} context yet. Write a note or upload a document Lictory AI should know about.`
                : `No ${scopeLabel[target.scope].toLowerCase()} context yet.`}
            </>
          }
        >
          {[...active, ...(showArchived ? archived : [])].map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              canManage={canManage}
              defaultOpen={e.id === linked}
              nameOf={nameOf}
              send={api.send}
              history={api.history}
            />
          ))}
        </SettingsList>
      )}
      {archived.length > 0 && (
        <div className="border-t border-border px-5 py-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowArchived((v) => !v)}
          >
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </Button>
        </div>
      )}
    </SettingsSection>
  );
}

function BudgetMeter({ used }: { used: number }) {
  const over = used > CONTEXT_PROMPT_BUDGET;
  return (
    <span
      className={cn(
        "ml-auto text-xs tabular-nums",
        over ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
      )}
      title="Characters of active context in this scope. Reviews include up to the budget across all scopes, narrower scopes first."
    >
      {chars(used)} / {chars(CONTEXT_PROMPT_BUDGET)} characters
      {over && " · over budget, the rest is trimmed"}
    </span>
  );
}

type FormFields = { title: string; content?: string; file?: File };

function ContextForm({
  kind,
  initial,
  onCancel,
  onSubmit,
}: {
  kind: "note" | "document";
  initial?: { title: string; content: string };
  onCancel: () => void;
  onSubmit: (fields: FormFields) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const upload = kind === "document" && !initial;
  return (
    <form
      className="space-y-3 border-b border-border bg-muted/40 px-5 py-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (upload && !file) return setError("Choose a document to upload.");
        if (file && file.size > MAX_CONTEXT_DOCUMENT_SIZE)
          return setError(
            `Documents can be at most ${MAX_CONTEXT_DOCUMENT_SIZE / 1024 / 1024} MB.`,
          );
        setPending(true);
        try {
          await onSubmit(upload ? { title, file: file! } : { title, content });
        } catch (err) {
          setError(err instanceof Error ? err.message : "Not saved.");
        } finally {
          setPending(false);
        }
      }}
    >
      <p className="text-[13px] font-medium">
        {initial ? "Edit entry" : upload ? "Upload document" : "New note"}
      </p>
      <label className="block text-[13px]">
        <span className="text-muted-foreground">Title</span>
        <Input
          className="mt-1 h-8 rounded-md text-sm"
          value={title}
          maxLength={MAX_CONTEXT_TITLE}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            upload ? "e.g. API design guidelines" : "e.g. Payments glossary"
          }
          required
          autoFocus
        />
      </label>
      {upload ? (
        <label className="block text-[13px]">
          <span className="text-muted-foreground">Document</span>
          <input
            type="file"
            accept={ACCEPT_CONTEXT_DOCUMENTS}
            className="mt-1 block w-full text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-2.5 file:py-1.5 file:text-[13px] file:font-medium"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !title.trim())
                setTitle(
                  f.name.replace(/\.[^.]+$/, "").slice(0, MAX_CONTEXT_TITLE),
                );
            }}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            PDF, Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV, Markdown
            or text, up to {MAX_CONTEXT_DOCUMENT_SIZE / 1024 / 1024} MB. It is
            converted to text on Lictory&apos;s server; scanned PDFs without
            text are not supported.
          </span>
        </label>
      ) : (
        <div className="text-[13px]">
          <span className="text-muted-foreground">Content (Markdown)</span>
          <MarkdownEditor
            aria-label="Context content"
            containerClassName="mt-1"
            value={content}
            onValueChange={setContent}
            rows={10}
            placeholder="State facts, rules and conventions plainly, e.g. “Every payment API is idempotent on the client's request ID.”"
          />
          <span
            className={cn(
              "mt-1 block text-xs tabular-nums",
              content.length > MAX_CONTEXT_CONTENT
                ? "text-destructive"
                : "text-muted-foreground",
            )}
          >
            {chars(content.length)} / {chars(MAX_CONTEXT_CONTENT)} characters
          </span>
        </div>
      )}
      <InlineError>{error}</InlineError>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending && (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
          )}
          {pending
            ? upload
              ? "Converting…"
              : "Saving…"
            : initial
              ? "Save new version"
              : upload
                ? "Upload"
                : "Add note"}
        </Button>
      </div>
    </form>
  );
}

function EntryRow({
  entry: e,
  canManage,
  defaultOpen,
  nameOf,
  send,
  history,
}: {
  entry: ContextEntrySummary;
  canManage: boolean;
  defaultOpen: boolean;
  nameOf: (id: string) => string;
  send: (fields: Record<string, string | File | undefined>) => Promise<void>;
  history: (entryId: string) => Promise<ContextVersionSummary[]>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<"view" | "edit" | "history">("view");
  const [versions, setVersions] = useState<ContextVersionSummary[]>();
  const [viewing, setViewing] = useState<ContextVersionSummary>();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const v = e.current;
  const Icon = e.kind === "document" ? FileText : NotebookPen;
  const act = async (fields: Record<string, string | File | undefined>) => {
    setError("");
    setPending(true);
    try {
      await send({ entryId: e.id, ...fields });
      setVersions(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Not saved.");
    } finally {
      setPending(false);
    }
  };
  const replaceId = `context-replace-${e.id}`;
  const shown = viewing ?? v;
  return (
    <div className={cn(e.archivedAt && "opacity-70")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-[13px] hover:bg-muted/40"
      >
        <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{v.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {v.source ? `${v.source.filename} · ` : "Note · "}v{v.number} ·{" "}
            {nameOf(v.authorId)} · {relativeTime(v.createdAt)} ·{" "}
            {chars(v.content.length)} characters
          </span>
        </span>
        {e.archivedAt && <Badge>Archived</Badge>}
      </button>
      {open && (
        <div className="space-y-3 px-5 pb-4">
          {mode === "edit" ? (
            <ContextForm
              kind="note"
              initial={{ title: v.title, content: v.content }}
              onCancel={() => setMode("view")}
              onSubmit={async (fields) => {
                await send({ action: "revise", entryId: e.id, ...fields });
                setVersions(undefined);
                setMode("view");
              }}
            />
          ) : (
            <>
              {mode === "history" && (
                <ol className="space-y-0.5 rounded-md border p-1.5">
                  {!versions && (
                    <li className="px-2 py-1 text-xs text-muted-foreground">
                      Loading history…
                    </li>
                  )}
                  {versions?.map((x) => (
                    <li key={x.id}>
                      <button
                        type="button"
                        aria-pressed={shown.id === x.id}
                        onClick={() =>
                          setViewing(x.id === v.id ? undefined : x)
                        }
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted",
                          shown.id === x.id && "bg-muted",
                        )}
                      >
                        <span className="w-8 font-medium tabular-nums">
                          v{x.number}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {x.title}
                          {x.source && ` · ${x.source.filename}`}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {nameOf(x.authorId)} · {relativeTime(x.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {viewing && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Viewing version {viewing.number}. Lictory AI uses version{" "}
                  {v.number}.
                </p>
              )}
              <div className="max-h-80 overflow-y-auto rounded-md border bg-background px-4 py-3">
                <Markdown
                  source={shown.content}
                  className="text-[13px] leading-6"
                />
              </div>
            </>
          )}
          <InlineError>{error}</InlineError>
          {mode !== "edit" && (
            <div className="flex flex-wrap gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (mode === "history") {
                    setMode("view");
                    setViewing(undefined);
                    return;
                  }
                  setMode("history");
                  if (!versions)
                    history(e.id)
                      .then(setVersions)
                      .catch((err: unknown) =>
                        setError(
                          err instanceof Error ? err.message : "Not loaded.",
                        ),
                      );
                }}
              >
                <History className="size-3.5" />
                {mode === "history"
                  ? "Hide history"
                  : `History (${e.versions})`}
              </Button>
              {canManage && !e.archivedAt && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      setViewing(undefined);
                      setMode("edit");
                    }}
                  >
                    <NotebookPen className="size-3.5" /> Edit
                  </Button>
                  {e.kind === "document" && (
                    <>
                      <input
                        id={replaceId}
                        type="file"
                        accept={ACCEPT_CONTEXT_DOCUMENTS}
                        className="sr-only"
                        aria-label={`Replace ${v.title} with a new file`}
                        onChange={(ev) => {
                          const file = ev.target.files?.[0];
                          ev.target.value = "";
                          if (file)
                            void act({
                              action: "revise",
                              title: v.title,
                              file,
                            });
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending}
                        onClick={() =>
                          document.getElementById(replaceId)?.click()
                        }
                      >
                        <Upload className="size-3.5" />
                        {pending ? "Converting…" : "Replace file"}
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => void act({ action: "archive" })}
                  >
                    <Archive className="size-3.5" /> Archive
                  </Button>
                </>
              )}
              {canManage && e.archivedAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => void act({ action: "restore" })}
                >
                  <RotateCcw className="size-3.5" /> Restore
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
