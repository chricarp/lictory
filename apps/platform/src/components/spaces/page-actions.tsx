import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "@lictory/ui/toast";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  iterationLabel,
  spaceLevelAtLeast,
} from "@lictory/core/contracts/protocol";
import { useRouter } from "@lictory/platform/lib/navigation";
import {
  isWithin,
  pageTree,
  placeUnder,
  readingOrder,
  type Placement,
  type Space,
  type SpacePage,
} from "@lictory/platform/data/spaces";
import {
  useCanWrite,
  useWorkspace,
} from "@lictory/platform/components/workspace/provider";
import {
  useSpacePages,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import {
  Dialog,
  Field,
  RadioCards,
} from "@lictory/platform/components/spaces/dialog";
import {
  pageTemplateKinds,
  pageTemplates,
  type PageTemplateContext,
  type PageTemplateKind,
} from "@lictory/core/spaces/template-catalog";

// Page tree actions of one space, shared by the tree, the space home and the
// page header so each action has one implementation and one dialog. Page
// structure is predicted locally (createPage, movePage, archivePage); a
// refused change is rolled back and reported like any other.

type PageActions = {
  space: Space;
  canEdit: boolean;
  createPage: (parentId: string | null) => void;
  movePage: (page: SpacePage) => void;
  moveTo: (page: SpacePage, to: Placement, announce: string) => void;
  archivePage: (page: SpacePage) => void;
  restorePage: (page: SpacePage) => void;
  // The latest polite announcement of a structural change.
  announcement: string;
};
const PageActionsContext = createContext<PageActions | null>(null);

export function usePageActions() {
  const value = useContext(PageActionsContext);
  if (!value) throw new Error("usePageActions requires PageActionsProvider.");
  return value;
}

export function PageActionsProvider({
  space,
  children,
}: {
  space: Space;
  children: ReactNode;
}) {
  const { organization, mutate } = useWorkspace();
  const { levelOf } = useSpaces();
  const online = useCanWrite();
  const pages = useSpacePages(space.id);
  const router = useRouter();
  const canEdit =
    spaceLevelAtLeast(levelOf(space.id), "edit") && !space.archivedAt;
  const [creating, setCreating] = useState<{ parentId: string | null }>();
  const [moving, setMoving] = useState<SpacePage>();
  const [announcement, setAnnouncement] = useState("");
  const titleOf = useCallback(
    (id: string | null) =>
      id ? (pages.find((p) => p.id === id)?.title ?? "a page") : space.name,
    [pages, space.name],
  );
  const moveTo = useCallback(
    (page: SpacePage, to: Placement, announce: string) => {
      void mutate({ type: "movePage", pageId: page.id, ...to });
      setAnnouncement(announce);
    },
    [mutate],
  );
  const restorePage = useCallback(
    (page: SpacePage) => {
      void mutate({ type: "archivePage", pageId: page.id, archived: false });
      setAnnouncement(`Restored “${page.title}”.`);
    },
    [mutate],
  );
  const archivePage = useCallback(
    (page: SpacePage) => {
      const byId = new Map(pages.map((p) => [p.id, p]));
      const subpages = pages.filter(
        (p) =>
          p.id !== page.id && !p.archivedAt && isWithin(byId, p.id, page.id),
      ).length;
      void mutate({ type: "archivePage", pageId: page.id, archived: true });
      const title =
        subpages > 0
          ? `Archived “${page.title}” and ${subpages === 1 ? "1 subpage" : `${subpages} subpages`}`
          : `Archived “${page.title}”`;
      setAnnouncement(`${title}.`);
      const id = toast.add({
        title,
        description:
          "Archived pages stay in the space. Show archived pages to restore them later.",
        timeout: 8000,
        actionProps: {
          children: "Undo",
          onClick: () => {
            toast.close(id);
            restorePage(page);
          },
        },
      });
    },
    [mutate, pages, restorePage],
  );
  const value = useMemo<PageActions>(
    () => ({
      space,
      canEdit: canEdit && online,
      createPage: (parentId) => setCreating({ parentId }),
      movePage: setMoving,
      moveTo,
      archivePage,
      restorePage,
      announcement,
    }),
    [space, canEdit, online, moveTo, archivePage, restorePage, announcement],
  );
  return (
    <PageActionsContext.Provider value={value}>
      {children}
      {creating && (
        <NewPageDialog
          parentTitle={
            creating.parentId ? titleOf(creating.parentId) : undefined
          }
          onClose={() => setCreating(undefined)}
          projectId={space.projectId}
          onCreate={async (title, template, context) => {
            const pageId = crypto.randomUUID();
            // A template is the page's first version; blank stays empty.
            // The document engine loads only when a template is chosen (a
            // failed load throws: the dialog stays open to try again).
            const content =
              template === "blank"
                ? undefined
                : (
                    await import("@lictory/core/spaces/templates")
                  ).templatePageContent(template, context);
            void mutate({
              type: "createPage",
              spaceId: space.id,
              pageId,
              parentId: creating.parentId,
              title,
              ...(content ? { content } : {}),
            });
            setCreating(undefined);
            setAnnouncement(`Created “${title}”.`);
            router.push(paths.spacePage(organization.slug, space.slug, pageId));
          }}
        />
      )}
      {moving && (
        <MovePageDialog
          space={space}
          page={moving}
          pages={pages}
          onClose={() => setMoving(undefined)}
          onMove={(to) => {
            moveTo(
              moving,
              to,
              `Moved “${moving.title}” ${to.parentId ? `into “${titleOf(to.parentId)}”` : `to the top level of ${space.name}`}.`,
            );
            setMoving(undefined);
          }}
        />
      )}
    </PageActionsContext.Provider>
  );
}

function NewPageDialog({
  parentTitle,
  projectId,
  onClose,
  onCreate,
}: {
  parentTitle?: string;
  // The project homing the space: iteration notes can list an iteration.
  projectId: string | null;
  onClose: () => void;
  onCreate: (
    title: string,
    template: PageTemplateKind,
    context: PageTemplateContext,
  ) => Promise<void>;
}) {
  const id = useId();
  const iterationFieldId = useId();
  const { projects, delivery } = useWorkspace();
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<PageTemplateKind>("blank");
  const project = projects.find((p) => p.id === projectId);
  const iterations = [...delivery.iterations.values()]
    .filter((i) => i.projectId === projectId && i.state !== "completed")
    .sort((a, b) => a.number - b.number);
  const [iterationId, setIterationId] = useState<string>(
    iterations.find((i) => i.state === "active")?.id ?? "",
  );
  const listsIteration =
    template === "iteration-notes" || template === "retrospective";
  // Creating waits for the template to load: one page per submit, and a
  // failure stays in the dialog with what to do next.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError("");
    try {
      await onCreate(trimmed, template, {
        projectId,
        iterationId: listsIteration ? iterationId || null : null,
      });
    } catch {
      setError(
        template === "blank"
          ? "The page was not created. Check your connection and try again."
          : `The ${pageTemplates[template].name} template could not be loaded, so no page was created. Check your connection and try again, or start from a blank page.`,
      );
      setPending(false);
    }
  };
  return (
    <Dialog
      title={parentTitle ? "New subpage" : "New page"}
      description={
        parentTitle
          ? `Adds a page under “${parentTitle}”.`
          : "Adds a page at the end of this space."
      }
      onClose={onClose}
      onSubmit={() => void submit()}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim() || pending}>
            {pending ? "Creating…" : "Create page"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor={id}>
          <Input
            id={id}
            data-autofocus
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Refund runbook"
            autoComplete="off"
          />
        </Field>
        <RadioCards
          legend="Start from"
          name="page-template"
          value={template}
          onChange={setTemplate}
          options={pageTemplateKinds.map((kind) => ({
            value: kind,
            label: pageTemplates[kind].name,
            description: pageTemplates[kind].description,
          }))}
        />
        {listsIteration && project && iterations.length > 0 && (
          <Field
            label="Iteration"
            htmlFor={iterationFieldId}
            optional
            hint="The page lists this iteration’s work, live."
          >
            <select
              id={iterationFieldId}
              value={iterationId}
              onChange={(e) => setIterationId(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-card px-3 text-[13px]"
            >
              <option value="">No live list</option>
              {iterations.map((i) => (
                <option key={i.id} value={i.id}>
                  {project.key} {iterationLabel(i, project.iterationMode)}
                  {i.state === "active" ? " (active)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {template !== "blank" && (
          <p className="text-xs text-muted-foreground">
            The template becomes the page’s first version. Edit it like any
            other page.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

const MAX_DESTINATIONS = 200;

// The keyboard and touch alternative to dragging: choose a new parent (or
// the top level) and whether the page goes first or last there.
function MovePageDialog({
  space,
  page,
  pages,
  onClose,
  onMove,
}: {
  space: Space;
  page: SpacePage;
  pages: SpacePage[];
  onClose: () => void;
  onMove: (to: Placement) => void;
}) {
  const tree = useMemo(() => pageTree(pages), [pages]);
  const destinations = useMemo(
    () =>
      readingOrder(tree).filter(
        ({ page: p }) => !isWithin(tree.byId, p.id, page.id),
      ),
    [tree, page.id],
  );
  const currentParent =
    page.parentId && tree.byId.has(page.parentId) ? page.parentId : null;
  const [parentId, setParentId] = useState<string | null>(currentParent);
  const [where, setWhere] = useState<"first" | "last">("last");
  const [query, setQuery] = useState("");
  const filterId = useId();
  const name = useId();
  const q = query.trim().toLowerCase();
  const matches = q
    ? destinations.filter((d) => d.page.title.toLowerCase().includes(q))
    : destinations;
  const shown = matches.slice(0, MAX_DESTINATIONS);
  const to = placeUnder(tree, page.id, parentId, where);
  const option = (
    value: string | null,
    label: string,
    depth: number,
    hint?: string,
  ) => (
    <label
      key={value ?? "top"}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 text-[13px] has-focus-visible:ring-2 has-focus-visible:ring-ring/60",
        parentId === value ? "bg-primary/8" : "hover:bg-muted",
      )}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      <input
        type="radio"
        name={name}
        checked={parentId === value}
        onChange={() => setParentId(value)}
        className="accent-primary"
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
  return (
    <Dialog
      title={`Move “${page.title}”`}
      description="Choose where the page and its subpages go. Pages move only within their space."
      onClose={onClose}
      onSubmit={() => to && onMove(to)}
      footer={
        <>
          {!to && (
            <span className="mr-auto text-xs text-muted-foreground">
              The page is already there.
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!to}>
            Move page
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Filter pages" htmlFor={filterId}>
          <Input
            id={filterId}
            data-autofocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by title"
            autoComplete="off"
            className="h-9 text-[13px]"
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium">New parent</legend>
          <div className="max-h-64 overflow-y-auto rounded-lg p-1 shadow-(--shadow-border)">
            {!q &&
              option(
                null,
                `Top level of ${space.name}`,
                0,
                currentParent === null ? "Current" : undefined,
              )}
            {shown.map(({ page: p, depth }) =>
              option(
                p.id,
                p.title,
                q ? 0 : depth,
                p.id === currentParent ? "Current" : undefined,
              ),
            )}
            {matches.length > shown.length && (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
                {matches.length - shown.length} more pages. Type to narrow down.
              </p>
            )}
            {q && matches.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                No pages match.
              </p>
            )}
          </div>
        </fieldset>
        <RadioCards
          legend="Position"
          name={`${name}-position`}
          value={where}
          onChange={setWhere}
          options={[
            {
              value: "last",
              label: "Last",
              description: "After its siblings.",
            },
            {
              value: "first",
              label: "First",
              description: "Before its siblings.",
            },
          ]}
        />
      </div>
    </Dialog>
  );
}
