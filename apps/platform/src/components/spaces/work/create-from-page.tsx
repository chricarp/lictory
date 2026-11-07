import { useId, useMemo, useRef, useState } from "react";
import { CircleAlert, ExternalLink, Info } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  PAGE_SOURCE_QUOTE_MAX,
  PROTOCOL,
  type Command,
} from "@lictory/core/contracts/protocol";
import { formatReference } from "@lictory/core/contracts/references";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import {
  enabledTypes,
  identifier,
  isTopLevel,
} from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lictory/ui/select";
import { Link } from "@lictory/platform/lib/navigation";
import { MarkdownEditor } from "@lictory/platform/components/editor/markdown-editor";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { TypeIcon } from "@lictory/platform/components/items/icons";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";
import {
  Dialog,
  Field,
  SegmentedChoice,
} from "@lictory/platform/components/spaces/dialog";
import type { DraftAnchor } from "@lictory/platform/components/spaces/work/draft-insert";

// Work from committed page text (a selection or a task): a person writes a
// work item, or asks Litto to draft proposals from the text and picks which
// to create. Every item created here records its source (page, commit,
// top-level block and the quote) with the item. The quote is copied into
// the item, whose readers may differ from the page's, which the dialog
// says before anything is created. Nothing is created without an explicit
// choice; afterwards the page can refer to the new items (an ordinary,
// visible edit of its draft) when the person can edit it.

export type CreateFromPageRequest = {
  origin: "selection" | "task";
  quote: string;
  title: string;
  // The top-level block holding the text (the source's block).
  topBlockId: string | null;
  // Where the page would mention the new items.
  anchor: DraftAnchor;
  mode: "write" | "draft";
};

export type CreatedItem = {
  workItemId: string;
  key: string;
  title: string;
  href: string;
};

type Draft = {
  title: string;
  problem: string;
  openQuestions: string[];
  inferences: string[];
  description: string;
};
type Drafted = {
  drafts: Draft[];
  truncated: boolean;
  filtered: { drafts: number; citations: number };
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export function CreateFromPageDialog({
  request,
  space,
  page,
  commit,
  canInsert,
  onInsert,
  onClose,
}: {
  request: CreateFromPageRequest;
  space: Space;
  page: SpacePage;
  commit: { id: string; title: string; version: number | undefined };
  canInsert: boolean;
  onInsert: (items: CreatedItem[], anchor: DraftAnchor) => void;
  onClose: () => void;
}) {
  const {
    organization,
    projects,
    delivery,
    directory,
    capabilitiesIn,
    applyConfirmed,
  } = useWorkspace();
  const aiAvailable = directory.ai.available && directory.ai.enabled;
  const creatable = projects.filter((p) => {
    if (p.archivedAt) return false;
    const c = capabilitiesIn(p.id);
    return c.editSpecifications || c.changeProperties;
  });
  const [mode, setMode] = useState<"write" | "draft">(
    request.mode === "draft" && aiAvailable ? "draft" : "write",
  );
  const drafting = mode === "draft";
  const projectsHere = drafting
    ? creatable.filter((p) => capabilitiesIn(p.id).editSpecifications)
    : creatable;
  const [projectId, setProjectId] = useState<string>(
    (projectsHere.find((p) => p.id === space.projectId) ?? projectsHere[0])
      ?.id ?? "",
  );
  const project = projectsHere.find((p) => p.id === projectId);
  const capabilities = capabilitiesIn(projectId);
  const types = enabledTypes(delivery, projectId).filter((t) =>
    t.hasSpecification
      ? capabilities.editSpecifications
      : capabilities.editSpecifications || capabilities.changeProperties,
  );
  const preferred =
    request.origin === "task"
      ? (types.find((t) => !t.hasSpecification && !isTopLevel(t)) ??
        types.find((t) => t.level === 1))
      : (types.find((t) => t.hasSpecification && t.level === 1) ??
        types.find((t) => !isTopLevel(t)));
  const [typeId, setTypeId] = useState<string>();
  const type = types.find((t) => t.id === typeId) ?? preferred ?? types[0];
  const proposalType = types.find((t) => t.hasSpecification && t.level === 1);

  const versionLabel = commit.version ? ` (version ${commit.version})` : "";
  const sourceLink = formatReference(
    { kind: "page", id: page.id, commitId: commit.id },
    `${commit.title}${versionLabel}`,
  );
  const quoted = request.quote
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const [title, setTitle] = useState(request.title);
  const [description, setDescription] = useState(
    `${quoted}\n\nSource: ${sourceLink}`,
  );
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreatedItem[] | null>(null);
  const [drafted, setDrafted] = useState<Drafted | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  // One mutation id per item to create: a retry after a lost answer
  // returns the same item instead of creating a second one.
  const attempts = useRef(
    new Map<string, { id: string; workItemId: string }>(),
  );
  const titleId = useId();

  const source = useMemo(
    () => ({
      pageId: page.id,
      commitId: commit.id,
      ...(request.topBlockId ? { blockId: request.topBlockId } : {}),
      quote: clip(request.quote.trim(), PAGE_SOURCE_QUOTE_MAX),
    }),
    [page.id, commit.id, request.topBlockId, request.quote],
  );

  const createOne = async (
    attemptKey: string,
    fields: { typeId: string; title: string; description: string },
  ): Promise<CreatedItem> => {
    const attempt = attempts.current.get(attemptKey) ?? {
      id: crypto.randomUUID(),
      workItemId: crypto.randomUUID(),
    };
    attempts.current.set(attemptKey, attempt);
    const command: Command = {
      type: "createWorkItem",
      projectId,
      workItemId: attempt.workItemId,
      typeId: fields.typeId,
      teamId: null,
      parentId: null,
      title: fields.title,
      description: fields.description || undefined,
      source,
    };
    await applyConfirmed({
      protocol: PROTOCOL,
      id: attempt.id,
      organizationId: organization.id,
      command,
    });
    return {
      workItemId: attempt.workItemId,
      key: project ? `${project.key}-…` : "",
      title: fields.title,
      href: project
        ? paths.item(organization.slug, project.key, attempt.workItemId)
        : "",
    };
  };

  const submitWrite = async () => {
    if (!type || !title.trim() || pending) return;
    setPending(true);
    setError(undefined);
    try {
      const item = await createOne(`write:${projectId}`, {
        typeId: type.id,
        title: title.trim(),
        description: description.trim(),
      });
      setCreated([item]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The work item was not created.",
      );
    } finally {
      setPending(false);
    }
  };

  const draft = async () => {
    if (!projectId || pending) return;
    setPending(true);
    setError(undefined);
    setDrafted(null);
    setChosen(new Set());
    try {
      const result = await callCapability<Drafted>("draftProposals", {
        organizationId: organization.id,
        projectId,
        sources: [
          { label: `${commit.title}${versionLabel}`, text: request.quote },
        ],
      });
      setDrafted(result);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} You can write the work item yourself instead.`
          : "Litto could not draft proposals right now. You can write the work item yourself instead.",
      );
    } finally {
      setPending(false);
    }
  };

  const createChosen = async () => {
    if (!drafted || !proposalType || !chosen.size || pending) return;
    setPending(true);
    setError(undefined);
    const made: CreatedItem[] = [];
    const failed: { index: number; reason: string }[] = [];
    for (const index of [...chosen].sort((a, b) => a - b)) {
      const d = drafted.drafts[index]!;
      try {
        made.push(
          await createOne(`draft:${projectId}:${index}`, {
            typeId: proposalType.id,
            title: d.title,
            description: `${d.description.trim()}\n\nSource: ${sourceLink}`,
          }),
        );
      } catch (e) {
        failed.push({
          index,
          reason: `“${d.title}”: ${e instanceof Error ? e.message : "not created"}`,
        });
      }
    }
    setPending(false);
    if (made.length) setCreated((c) => [...(c ?? []), ...made]);
    // Partial success is kept: what was created stays created, and creating
    // again retries only what failed (with the same mutation ids).
    setChosen(new Set(failed.map((f) => f.index)));
    setError(
      failed.length
        ? `${made.length ? `${made.length} created. ` : ""}Not created: ${failed.map((f) => f.reason).join("; ")}. Create again to retry.`
        : undefined,
    );
  };

  // Keys are assigned by the server; show them once the items synchronize.
  const { items } = useWorkspace();
  const resolved = (created ?? []).map((c) => {
    const item = items.find((i) => i.id === c.workItemId);
    const key = item ? identifier(project, item.number) : null;
    return {
      ...c,
      key: key ?? c.key,
      href:
        key && project
          ? paths.item(organization.slug, project.key, key)
          : c.href,
      known: Boolean(item),
    };
  });

  if (created && !error)
    return (
      <Dialog
        title={
          resolved.length === 1
            ? `${resolved[0]!.known ? resolved[0]!.key : "Work item"} created`
            : `${resolved.length} work items created`
        }
        description={`Each one records that it came from ${commit.title}${versionLabel}.`}
        onClose={onClose}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Done
            </Button>
            {canInsert && (
              <Button
                disabled={resolved.some((r) => !r.known)}
                onClick={() =>
                  onInsert(
                    resolved.map((r) => ({ ...r })),
                    request.anchor,
                  )
                }
              >
                Add to the page
              </Button>
            )}
          </>
        }
      >
        <ul className="space-y-1" data-testid="created-from-page">
          {resolved.map((r) => (
            <li
              key={r.workItemId}
              className="flex items-center gap-2 text-[13px]"
            >
              <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                {r.known ? r.key : "…"}
              </span>
              <Link
                href={r.href}
                className="min-w-0 flex-1 truncate font-medium hover:underline"
              >
                {r.title}
              </Link>
              <ExternalLink
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
            </li>
          ))}
        </ul>
        {canInsert && (
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            “Add to the page” opens the editor and mentions{" "}
            {resolved.length === 1 ? "it" : "them"} after the{" "}
            {request.origin === "task" ? "task" : "selected text"}. Nothing is
            published until you publish.
          </p>
        )}
      </Dialog>
    );

  const restricted = space.accessMode === "restricted";
  const disclosure = (
    <p
      className={cn(
        "flex gap-2 rounded-lg px-3 py-2 text-xs leading-5",
        restricted
          ? "bg-warning/8 text-foreground ring-1 ring-warning/25 ring-inset"
          : "bg-muted text-muted-foreground",
      )}
    >
      {restricted ? (
        <CircleAlert
          className="mt-0.5 size-3.5 shrink-0 text-warning"
          aria-hidden
        />
      ) : (
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      )}
      <span>
        {restricted
          ? `${space.name} is restricted, but work items are read by everyone in ${organization.name}. The quoted text is copied into ${project?.key ?? "the project"}, where people who cannot read this page will see it.`
          : `The quoted text is copied into ${project?.key ?? "the project"}, where everyone in ${organization.name} can read it. Later edits to this page do not change the item; it links back to this version.`}
        {drafting &&
          " Drafting sends the text to the AI provider your organization configured; it is not stored."}
      </span>
    </p>
  );

  const projectField = (
    <Field label="Project">
      <Select
        value={projectId}
        onValueChange={(value) => {
          setProjectId(value);
          setTypeId(undefined);
          setDrafted(null);
          setChosen(new Set());
        }}
      >
        <SelectTrigger aria-label="Project" className="w-full">
          <SelectValue placeholder="Choose a project" />
        </SelectTrigger>
        <SelectContent>
          {projectsHere.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );

  return (
    <Dialog
      title={drafting ? "Draft proposals with Litto" : "Create work item"}
      description={
        <>
          From {request.origin === "task" ? "a task in" : "text in"}{" "}
          <span className="font-medium text-foreground">
            {commit.title}
            {versionLabel}
          </span>
          .
        </>
      }
      onClose={onClose}
      onSubmit={() =>
        void (drafting ? (drafted ? createChosen() : draft()) : submitWrite())
      }
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {drafting ? (
            drafted ? (
              <>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void draft()}
                >
                  Draft again
                </Button>
                <Button
                  type="submit"
                  disabled={pending || !chosen.size || !proposalType}
                >
                  {pending
                    ? "Creating…"
                    : chosen.size
                      ? `Create ${chosen.size === 1 ? "1 proposal" : `${chosen.size} proposals`}`
                      : "Choose drafts to create"}
                </Button>
              </>
            ) : (
              <Button type="submit" disabled={pending || !projectId}>
                {pending ? "Drafting…" : "Draft proposals"}
              </Button>
            )
          ) : (
            <Button type="submit" disabled={pending || !type || !title.trim()}>
              {pending ? "Creating…" : "Create work item"}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {aiAvailable && (
          <SegmentedChoice
            label="How"
            name="create-from-page-mode"
            value={mode}
            options={[
              { value: "write", label: "Write it" },
              { value: "draft", label: "Draft with Litto" },
            ]}
            onChange={(value) => {
              setMode(value);
              setError(undefined);
              if (
                value === "draft" &&
                !projectsHere.some((p) => p.id === projectId)
              )
                setProjectId(
                  creatable.find((p) => capabilitiesIn(p.id).editSpecifications)
                    ?.id ?? "",
                );
            }}
          />
        )}
        {/* Written by hand, the quote is in the description below (what
            is saved); Litto reads it as shown here. */}
        {(drafting || !projectsHere.length) && (
          <blockquote className="max-h-32 overflow-y-auto rounded-lg border-l-2 border-foreground/15 bg-muted/50 px-3 py-2 text-[13px] leading-5 whitespace-pre-line text-muted-foreground">
            {clip(request.quote, 1200)}
          </blockquote>
        )}
        {!projectsHere.length ? (
          <p className="text-[13px] text-muted-foreground">
            {drafting
              ? "Your disciplines cannot create proposals in any project. Ask a project administrator for a discipline that edits specifications."
              : "Your disciplines cannot create work items in any project. Ask a project administrator for a discipline that edits specifications or changes properties."}
          </p>
        ) : drafting ? (
          <>
            {projectField}
            {drafted && (
              <fieldset
                className="space-y-2"
                aria-describedby={`${titleId}-drafts`}
              >
                <legend className="text-xs font-medium">
                  Choose the proposals to create
                </legend>
                <p
                  id={`${titleId}-drafts`}
                  className="text-xs text-muted-foreground"
                >
                  Litto’s drafts are suggestions. Only the ones you choose are
                  created, as draft proposals for {project?.name}.
                  {drafted.filtered.drafts > 0 &&
                    ` ${drafted.filtered.drafts} draft${drafted.filtered.drafts === 1 ? " was" : "s were"} left out because ${drafted.filtered.drafts === 1 ? "it" : "they"} cited nothing from the text.`}
                  {drafted.truncated &&
                    " The text was too long; only its beginning was read."}
                </p>
                {drafted.drafts.length ? (
                  drafted.drafts.map((d, index) => (
                    <label
                      key={index}
                      className={cn(
                        "flex cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-[13px] shadow-(--shadow-border) has-focus-visible:ring-2 has-focus-visible:ring-ring/60",
                        chosen.has(index)
                          ? "bg-primary/6 ring-1 ring-primary/40"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={chosen.has(index)}
                        onChange={(e) =>
                          setChosen((current) => {
                            const next = new Set(current);
                            if (e.target.checked) next.add(index);
                            else next.delete(index);
                            return next;
                          })
                        }
                        className="mt-0.5 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block font-medium">{d.title}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                          {clip(d.problem, 240)}
                        </span>
                        {(d.openQuestions.length > 0 ||
                          d.inferences.length > 0) && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {[
                              d.openQuestions.length &&
                                `${d.openQuestions.length} open question${d.openQuestions.length === 1 ? "" : "s"}`,
                              d.inferences.length &&
                                `${d.inferences.length} inferred, not stated`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        )}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-[13px] text-muted-foreground">
                    Litto found nothing to propose in this text.
                  </p>
                )}
              </fieldset>
            )}
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {projectField}
              <Field label="Type">
                <Select value={type?.id ?? ""} onValueChange={setTypeId}>
                  <SelectTrigger aria-label="Type" className="w-full">
                    <SelectValue placeholder="Choose a type" />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <span className="inline-flex items-center gap-1.5">
                          <TypeIcon type={t} />
                          {t.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Title" htmlFor={titleId}>
              <Input
                id={titleId}
                data-autofocus
                value={title}
                maxLength={240}
                onChange={(e) => setTitle(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <div className="space-y-1.5">
              <p className="text-xs font-medium">Description</p>
              <MarkdownEditor
                value={description}
                onValueChange={setDescription}
                aria-label="Description"
                compact
                minHeight="5rem"
                maxHeight="15rem"
              />
            </div>
            {type && (
              <p className="text-xs text-muted-foreground">
                {type.hasSpecification
                  ? "It starts as a draft proposal to refine and review. Creating it does not commit anyone to delivery."
                  : "It goes straight to delivery."}
              </p>
            )}
          </>
        )}
        {projectsHere.length > 0 && disclosure}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
