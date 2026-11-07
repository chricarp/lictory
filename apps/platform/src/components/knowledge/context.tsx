import { useId, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  FilePlus2,
  FileText,
  Plus,
  X,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import {
  iterationLabel,
  type Iteration,
} from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import { toast } from "@lictory/ui/toast";
import { Link, useRouter } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpaces } from "@lictory/platform/components/spaces/store";
import {
  contextStep,
  type ContextLink,
  type ContextScope,
} from "@lictory/platform/data/knowledge";
import { templatePageContent } from "@lictory/core/spaces/templates";
import { useProjectContext } from "@lictory/platform/components/knowledge/store";
import { PagePicker } from "@lictory/platform/components/knowledge/page-picker";

// Context pages of delivery surfaces (docs/internals/delivery.md, Context
// pages): the few pages a project, a team or an iteration keeps at hand
// (goals, designs, runbooks, retrospectives). Only pages I can read are
// listed or counted. Project administrators and people whose discipline
// changes item properties manage the lists; the controls here only mirror
// that, the server decides.

export type ContextList = ContextScope & {
  // "Project", "Platform team", "Sprint 3".
  label: string;
  iteration?: Iteration;
};

const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "The change was not saved.";

function useCanManageContext(projectId: string) {
  const { canManage, capabilitiesIn } = useWorkspace();
  return canManage(projectId) || capabilitiesIn(projectId).changeProperties;
}

// A slim "Context" control for a delivery surface's header: the context
// pages of each list in view, in one popover.
export function ContextControl({
  project,
  lists,
  compact = false,
}: {
  project: Project;
  lists: ContextList[];
  // An icon with the count (iteration rows).
  compact?: boolean;
}) {
  const { listOf } = useProjectContext(project.id);
  const canManage = useCanManageContext(project.id);
  const count = lists.reduce((n, l) => n + listOf(l).length, 0);
  const [adding, setAdding] = useState<ContextList>();
  const [notes, setNotes] = useState<ContextList>();
  if (compact && !count && !canManage) return null;
  const name = lists.map((l) => l.label).join(" and ");
  return (
    <Popover
      width={360}
      align={compact ? "end" : "start"}
      onOpenChange={(open) => {
        if (open) return;
        setAdding(undefined);
        setNotes(undefined);
      }}
      trigger={(props) => (
        <Button
          {...props}
          variant="ghost"
          size="sm"
          aria-label={`Context pages of ${name}${count ? `: ${count}` : ""}`}
          title={`Context pages of ${name}`}
        >
          <BookOpen className="size-3.5" aria-hidden />
          {!compact && <span className="max-sm:hidden">Context</span>}
          {count > 0 && (
            <span className="text-muted-foreground tabular-nums">{count}</span>
          )}
        </Button>
      )}
    >
      {(close) =>
        adding ? (
          <AddContextPage
            project={project}
            list={adding}
            exclude={new Set(listOf(adding).map((l) => l.pageId))}
            onDone={close}
          />
        ) : notes?.iteration ? (
          <IterationNotesForm
            project={project}
            iteration={notes.iteration}
            onBack={() => setNotes(undefined)}
            onDone={close}
          />
        ) : (
          <div className="max-h-[70vh] overflow-y-auto p-1">
            {lists.map((list) => (
              <ContextSection
                key={`${list.teamId ?? ""}:${list.iterationId ?? ""}`}
                project={project}
                list={list}
                links={listOf(list)}
                canManage={canManage}
                onAdd={() => setAdding(list)}
                onCreateNotes={
                  list.iteration ? () => setNotes(list) : undefined
                }
                heading
              />
            ))}
          </div>
        )
      }
    </Popover>
  );
}

// One list of context pages, for a popover or inline (the iteration
// report).
export function ContextSection({
  project,
  list,
  links,
  canManage,
  onAdd,
  onCreateNotes,
  actions,
  heading = false,
}: {
  project: Project;
  list: ContextList;
  links: ContextLink[];
  canManage: boolean;
  onAdd?: () => void;
  onCreateNotes?: () => void;
  // Replaces the add buttons (inline lists open their own popovers).
  actions?: React.ReactNode;
  heading?: boolean;
}) {
  const { organization, mutateConfirmed } = useWorkspace();
  const headingId = useId();
  const fail = (title: string) => (e: unknown) =>
    toast.add({
      title,
      type: "error",
      description: errorText(e),
      timeout: 8000,
    });
  const move = (link: ContextLink, direction: -1 | 1) => {
    const step = contextStep(links, link.id, direction);
    if (!step) return;
    mutateConfirmed({
      type: "moveContextPage",
      projectId: project.id,
      linkId: link.id,
      ...step,
    }).catch(fail("Page not moved"));
  };
  const unlink = (link: ContextLink, index: number) => {
    mutateConfirmed({
      type: "unlinkContextPage",
      projectId: project.id,
      linkId: link.id,
    })
      .then(() => {
        const id = toast.add({
          title: `Removed “${link.page.title}” from ${list.label}`,
          timeout: 8000,
          actionProps: {
            children: "Undo",
            onClick: () => {
              toast.close(id);
              // Back where it was, between its former neighbours.
              mutateConfirmed({
                type: "linkContextPage",
                projectId: project.id,
                linkId: crypto.randomUUID(),
                pageId: link.pageId,
                teamId: list.teamId ?? null,
                iterationId: list.iterationId ?? null,
                afterId: links[index - 1]?.id ?? null,
                beforeId: links[index + 1]?.id ?? null,
              }).catch(fail("Page not added back"));
            },
          },
        });
      })
      .catch(fail("Page not removed"));
  };
  return (
    <section aria-labelledby={heading ? headingId : undefined}>
      {heading && (
        <h3
          id={headingId}
          className="px-2 pt-2 pb-1 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase"
        >
          {list.label}
        </h3>
      )}
      {links.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {list.iteration
            ? "Keep the goal, notes and retrospective of this iteration here."
            : "Keep the pages this work relies on (goals, designs, runbooks) one click away."}
        </p>
      ) : (
        <ul>
          {links.map((link, index) => (
            <li
              key={link.id}
              className="group relative flex min-h-8 items-center gap-2 rounded-md px-2 text-[13px] hover:bg-muted"
            >
              <FileText
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <Link
                href={paths.spacePage(
                  organization.slug,
                  link.space.slug,
                  link.page.id,
                )}
                className="min-w-0 flex-1 truncate py-1.5 outline-none after:absolute after:inset-0 focus-visible:underline"
              >
                {link.page.title || "Untitled"}
              </Link>
              <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground group-focus-within:hidden group-hover:hidden">
                {link.space.name}
              </span>
              {canManage && (
                <span className="relative z-10 hidden items-center group-focus-within:flex group-hover:flex touch:flex">
                  <IconButton
                    label={`Move “${link.page.title}” up`}
                    disabled={index === 0}
                    onClick={() => move(link, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={`Move “${link.page.title}” down`}
                    disabled={index === links.length - 1}
                    onClick={() => move(link, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </IconButton>
                  <IconButton
                    label={`Remove “${link.page.title}” from ${list.label}`}
                    onClick={() => unlink(link, index)}
                  >
                    <X className="size-3.5" />
                  </IconButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="flex flex-wrap gap-1 px-1 pt-1 pb-1.5">
          {actions ?? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onAdd}
                aria-label={`Add a page to ${list.label}`}
              >
                <Plus className="size-3.5" aria-hidden /> Add page
              </Button>
              {onCreateNotes && (
                <Button variant="ghost" size="sm" onClick={onCreateNotes}>
                  <FilePlus2 className="size-3.5" aria-hidden /> Create
                  iteration notes
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function AddContextPage({
  project,
  list,
  exclude,
  onDone,
}: {
  project: Project;
  list: ContextList;
  exclude: ReadonlySet<string>;
  onDone: () => void;
}) {
  const { mutateConfirmed } = useWorkspace();
  return (
    <PagePicker
      title={`Add a page to ${list.label}`}
      exclude={exclude}
      onSelect={({ page }) => {
        onDone();
        mutateConfirmed({
          type: "linkContextPage",
          projectId: project.id,
          linkId: crypto.randomUUID(),
          pageId: page.id,
          teamId: list.teamId ?? null,
          iterationId: list.iterationId ?? null,
        }).catch((e: unknown) =>
          toast.add({
            title: "Page not added",
            type: "error",
            description: errorText(e),
            timeout: 8000,
          }),
        );
      }}
    />
  );
}

// Spaces where I may create the notes page, the project's own first.
function useNotesSpaces(project: Project) {
  const { index, levelOf } = useSpaces();
  return useMemo(() => {
    const editable = index.spaces.filter(
      (s) => !s.archivedAt && levelOf(s.id) === "edit",
    );
    const rank = (s: (typeof editable)[number]) =>
      s.projectId === project.id ? (s.teamId ? 1 : 0) : s.projectId ? 3 : 2;
    return editable.sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name),
    );
  }, [index.spaces, levelOf, project.id]);
}

// Creates a new page from the iteration notes template in a space I edit
// (its goal and a live list of the iteration's work), links it to the
// iteration and opens it. Creating a page publishes its first version, as
// "New page" does in the space; Work never changes existing pages itself.
export function IterationNotesForm({
  project,
  iteration,
  onBack,
  onDone,
}: {
  project: Project;
  iteration: Iteration;
  onBack?: () => void;
  onDone: () => void;
}) {
  const labelId = usePopover()?.labelId;
  const router = useRouter();
  const { organization, mutateConfirmed } = useWorkspace();
  const spaces = useNotesSpaces(project);
  const label = iterationLabel(iteration, project.iterationMode);
  const [spaceId, setSpaceId] = useState(spaces[0]?.id ?? "");
  const [title, setTitle] = useState(`${label} notes`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const spaceField = useId();
  const titleField = useId();
  const space = spaces.find((s) => s.id === spaceId);
  const create = async () => {
    if (!space || !title.trim()) return;
    setBusy(true);
    setError(undefined);
    const pageId = crypto.randomUUID();
    try {
      await mutateConfirmed({
        type: "createPage",
        spaceId: space.id,
        pageId,
        title: title.trim(),
        content: templatePageContent("iteration-notes", {
          projectId: project.id,
          iterationId: iteration.id,
          goal: iteration.goal,
        }),
      });
      await mutateConfirmed({
        type: "linkContextPage",
        projectId: project.id,
        linkId: crypto.randomUUID(),
        pageId,
        iterationId: iteration.id,
      });
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      return;
    }
    onDone();
    router.push(paths.spacePage(organization.slug, space.slug, pageId));
  };
  return (
    <form
      className="flex flex-col gap-2.5 p-3 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void create();
      }}
    >
      <h2 id={labelId} className="text-sm font-semibold">
        Notes for {label}
      </h2>
      <p className="text-xs text-muted-foreground">
        A new page with the goal, a live list of the iteration’s work, risks and
        a retrospective, kept with this iteration.
      </p>
      {spaces.length === 0 ? (
        <p role="alert" className="text-xs text-destructive">
          You can edit no space yet. Ask for edit access to a project space, or
          create one.
        </p>
      ) : (
        <>
          <label htmlFor={spaceField} className="text-xs font-medium">
            Space
          </label>
          <select
            id={spaceField}
            value={spaceId}
            onChange={(e) => setSpaceId(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-[13px] touch:text-base"
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label htmlFor={titleField} className="text-xs font-medium">
            Title
          </label>
          <input
            id={titleField}
            autoFocus
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 touch:text-base"
          />
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        {onBack && (
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            Back
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={busy || !space || !title.trim()}
        >
          {busy ? "Creating…" : "Create and open"}
        </Button>
      </div>
    </form>
  );
}

// The iteration report's context pages, listed inline.
export function IterationContext({
  project,
  iteration,
}: {
  project: Project;
  iteration: Iteration;
}) {
  const { listOf } = useProjectContext(project.id);
  const canManage = useCanManageContext(project.id);
  const list: ContextList = {
    label: iterationLabel(iteration, project.iterationMode),
    iterationId: iteration.id,
    iteration,
  };
  const links = listOf(list);
  return (
    <section
      aria-labelledby="iteration-pages"
      className="rounded-xl bg-card p-3 shadow-(--shadow-border)"
    >
      <h2 id="iteration-pages" className="mb-1 px-1 text-sm font-semibold">
        Pages
      </h2>
      <ContextSection
        project={project}
        list={list}
        links={links}
        canManage={canManage}
        actions={
          <>
            <Popover
              width={360}
              trigger={(props) => (
                <Button {...props} variant="ghost" size="sm">
                  <Plus className="size-3.5" aria-hidden /> Add page
                </Button>
              )}
            >
              {(close) => (
                <AddContextPage
                  project={project}
                  list={list}
                  exclude={new Set(links.map((l) => l.pageId))}
                  onDone={close}
                />
              )}
            </Popover>
            <Popover
              width={360}
              trigger={(props) => (
                <Button {...props} variant="ghost" size="sm">
                  <FilePlus2 className="size-3.5" aria-hidden /> Create
                  iteration notes
                </Button>
              )}
            >
              {(close) => (
                <IterationNotesForm
                  project={project}
                  iteration={iteration}
                  onDone={close}
                />
              )}
            </Popover>
          </>
        }
      />
    </section>
  );
}
