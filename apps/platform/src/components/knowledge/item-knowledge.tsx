import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  FilePen,
  FileText,
  GitBranch,
  Paperclip,
  Plus,
  Quote,
  X,
} from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import {
  identifier,
  relativeTime,
  type Project,
} from "@lictory/core/lib/work-items";
import {
  pageAttachmentPurposes,
  type PageAttachmentPurpose,
  type WorkItem,
} from "@lictory/core/contracts/protocol";
import {
  branchNameProblem,
  finalizeBranchName,
  sanitizeBranchNameInput,
} from "@lictory/core/lib/branch-name";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import { Badge, SectionLabel } from "@lictory/ui/primitives";
import { toast } from "@lictory/ui/toast";
import { Link, useRouter } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  usePageHistory,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import {
  proposalState,
  purposeLabels,
  type ItemKnowledgePage,
  type ProposalState,
} from "@lictory/platform/data/knowledge";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";
import {
  useItemKnowledge,
  usePageLinkDetails,
  type PageLinkDetails,
} from "@lictory/platform/components/knowledge/store";
import {
  PagePicker,
  type PageChoice,
} from "@lictory/platform/components/knowledge/page-picker";
import { knowledgeAnchor } from "@lictory/platform/components/knowledge/anchor";

// "Knowledge 3" beside the item's other header toggles (Discussions,
// Changes): the readable pages about the item, counted as lists count them.
// Where the specification is shown it brings the section into view; screens
// that replace it (branches, pull requests, history) show the section in a
// popover, so the next reviewer has the background at hand everywhere.
export function KnowledgeJump({
  item,
  project,
  inline,
}: {
  item: WorkItem;
  project: Project;
  inline: boolean;
}) {
  const { count } = useItemKnowledge(item);
  if (!count) return null;
  // Named by what it shows: "Knowledge 3 pages about this item".
  const content = (
    <>
      <BookOpen className="size-3.5" aria-hidden />
      <span className="max-sm:sr-only @max-[62rem]/frame:sr-only">
        Knowledge
      </span>
      <span className="text-muted-foreground tabular-nums">{count}</span>
      <span className="sr-only">
        {count === 1 ? " page" : " pages"} about this item
      </span>
    </>
  );
  if (inline)
    return (
      <Button
        variant="ghost"
        size="sm"
        title="Pages about this item"
        onClick={() => {
          const section = document.getElementById(knowledgeAnchor);
          section?.scrollIntoView({ block: "start" });
          section?.focus({ preventScroll: true });
        }}
      >
        {content}
      </Button>
    );
  return (
    <Popover
      width={440}
      align="end"
      trigger={(props) => (
        <Button {...props} variant="ghost" size="sm">
          {content}
        </Button>
      )}
    >
      {() => (
        <div className="max-h-[70vh] overflow-y-auto p-3">
          <ItemKnowledge
            item={item}
            project={project}
            canChange={false}
            compact
          />
        </div>
      )}
    </Popover>
  );
}

// The work item's Knowledge section (docs/internals/knowledge-links.md, Work
// surfaces): the pages that mention the item, are attached to it or that
// its specification cites, the page it was created from and the page
// updates proposed from it. Only pages I can read appear, and nothing
// counts or hints at the others.

const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "The change was not saved.";

export function ItemKnowledge({
  item,
  project,
  canChange,
  compact = false,
}: {
  item: WorkItem;
  project: Project;
  canChange: boolean;
  // Read-only, in the Knowledge popover of screens that replace the
  // specification (branches, pull requests, history).
  compact?: boolean;
}) {
  const { organization, mutateConfirmed, memberName } = useWorkspace();
  const { knowledge, loaded } = useItemKnowledge(item);
  const key = identifier(project, item.number);
  const requests = useMemo(
    () =>
      knowledge.pages.flatMap((p) => {
        const versions = [
          ...(p.attachment?.commitId ? [p.attachment.commitId] : []),
          ...(p.citation?.current?.commitIds ?? []),
          ...(p.citation?.earlier?.commitIds ?? []),
        ];
        if (!p.mention && !versions.length) return [];
        const pinned = pinnedVersion(p);
        return [
          {
            pageId: p.page.id,
            ...(p.mention
              ? {
                  blocks: {
                    commitId: p.mention.commitId,
                    blockIds: p.mention.blockIds.slice(0, 3),
                  },
                  // What the pinned version said in the same place.
                  ...(pinned && pinned !== p.mention.commitId
                    ? { pinned: { commitId: pinned } }
                    : {}),
                }
              : {}),
            ...(versions.length ? { versions: [...new Set(versions)] } : {}),
          },
        ];
      }),
    [knowledge.pages],
  );
  const details = usePageLinkDetails(requests);
  const [attaching, setAttaching] = useState<PageChoice>();
  const sectionRef = useRef<HTMLElement>(null);
  // Arriving from "N pages" in a list or preview.
  useEffect(() => {
    if (window.location.hash === `#${knowledgeAnchor}`)
      sectionRef.current?.scrollIntoView({ block: "start" });
  }, []);
  const pageHref = (space: Space, page: SpacePage) =>
    paths.spacePage(organization.slug, space.slug, page.id);
  const attached = useMemo(
    () =>
      new Set(
        knowledge.pages.filter((p) => p.attachment).map((p) => p.page.id),
      ),
    [knowledge.pages],
  );
  const related = useMemo(
    () =>
      new Map(
        knowledge.pages.map((p) => [
          p.page.id,
          p.attachment
            ? `Attached · ${purposeLabels[p.attachment.purpose]}`
            : p.citation?.current
              ? "Cited by the specification"
              : p.mention
                ? `Mentions ${key}`
                : "Cited earlier",
        ]),
      ),
    [knowledge.pages, key],
  );
  const detach = async (entry: ItemKnowledgePage) => {
    const attachment = entry.attachment!;
    try {
      await mutateConfirmed({
        type: "detachPage",
        workItemId: item.id,
        attachmentId: attachment.attachmentId,
      });
    } catch (e) {
      toast.add({
        title: "Page not detached",
        type: "error",
        description: errorText(e),
        timeout: 8000,
      });
      return;
    }
    const id = toast.add({
      title: `Detached “${entry.page.title}”`,
      timeout: 8000,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toast.close(id);
          mutateConfirmed({
            type: "attachPage",
            workItemId: item.id,
            attachmentId: crypto.randomUUID(),
            pageId: entry.page.id,
            purpose: attachment.purpose,
            commitId: attachment.commitId,
          }).catch((e: unknown) =>
            toast.add({
              title: "Page not attached again",
              type: "error",
              description: errorText(e),
              timeout: 8000,
            }),
          );
        },
      },
    });
  };
  const empty =
    !knowledge.pages.length && !knowledge.source && !knowledge.proposals.length;
  return (
    <section
      ref={sectionRef}
      id={compact ? undefined : knowledgeAnchor}
      tabIndex={-1}
      aria-labelledby={`${knowledgeAnchor}-label`}
      className="scroll-mt-4 outline-none"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <SectionLabel>
          <span id={`${knowledgeAnchor}-label`}>Knowledge</span>
        </SectionLabel>
        <div hidden={compact} className="ml-auto flex items-center gap-1">
          <ProposePageUpdate item={item} itemKey={key} first={related} />
          {canChange && (
            <AttachPage
              itemKey={key}
              exclude={attached}
              first={related}
              onChoose={setAttaching}
            />
          )}
        </div>
      </div>
      {attaching && canChange && (
        <AttachForm
          key={attaching.page.id}
          item={item}
          itemKey={key}
          choice={attaching}
          onBack={() => setAttaching(undefined)}
          onDone={() => setAttaching(undefined)}
        />
      )}
      {knowledge.source && (
        <SourceQuote source={knowledge.source} href={pageHref} />
      )}
      {empty ? (
        loaded && (
          <p className="text-[13px] text-muted-foreground">
            Pages that mention {key} with “#”, cite it in its specification or
            are attached here (background, design, runbooks) appear in this
            list.
          </p>
        )
      ) : knowledge.pages.length > 0 ? (
        <ul
          aria-label={`Pages about ${key}`}
          className="overflow-hidden rounded-lg border"
        >
          {knowledge.pages.map((entry) => (
            <KnowledgeRow
              key={entry.page.id}
              entry={entry}
              itemKey={key}
              revisionNumber={item.revisionNumber}
              details={details?.get(entry.page.id)}
              href={pageHref(entry.space, entry.page)}
              onDetach={
                canChange && entry.attachment
                  ? () => void detach(entry)
                  : undefined
              }
            />
          ))}
        </ul>
      ) : null}
      {knowledge.proposals.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1 text-xs text-muted-foreground">
            Page updates proposed from {key}
          </h4>
          <ul className="overflow-hidden rounded-lg border">
            {knowledge.proposals.map((origin) => {
              const { state, pullRequestId } = proposalState(origin);
              const base = pageHref(origin.space, origin.page);
              const href = pullRequestId
                ? `${base}/history?view=pulls&pr=${pullRequestId}`
                : origin.deletedAt
                  ? base
                  : `${base}?branch=${origin.branchId}`;
              const pageTitle = origin.page.title || "Untitled";
              // Named by the change (its pull request's title, or the title
              // it was opened with before there is one), with the page as
              // context; the branch is machinery, on hover.
              const change =
                origin.pullRequests.at(-1)?.title ?? origin.title ?? undefined;
              return (
                <li
                  key={origin.id}
                  title={`Branch ${origin.name}`}
                  className="relative flex min-h-11 items-start gap-x-2.5 px-3 py-2 text-[13px] hover:bg-muted/50"
                >
                  <GitBranch
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <Link
                      href={href}
                      className="line-clamp-2 font-medium break-words after:absolute after:inset-0 focus-visible:underline"
                    >
                      {change ?? pageTitle}
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      {change && (
                        <>
                          <span className="text-foreground/80">
                            {pageTitle}
                          </span>
                          {" · "}
                        </>
                      )}
                      {typeof origin.revisionNumber === "number" && (
                        <>From revision {origin.revisionNumber} · </>
                      )}
                      {memberName(origin.authorId)} ·{" "}
                      <time dateTime={origin.createdAt}>
                        {relativeTime(origin.createdAt)}
                      </time>
                      <span className="sr-only"> · branch {origin.name}</span>
                    </span>
                  </span>
                  <ProposalBadge state={state} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

const proposalLabels: Record<
  ProposalState,
  { label: string; tone: "neutral" | "good" | "info" }
> = {
  no_pull_request: { label: "Not proposed yet", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "In review", tone: "info" },
  merged: { label: "Merged", tone: "good" },
  closed: { label: "Closed", tone: "neutral" },
  branch_deleted: { label: "Branch deleted", tone: "neutral" },
};

function ProposalBadge({ state }: { state: ProposalState }) {
  const { label, tone } = proposalLabels[state];
  return <Badge tone={tone}>{label}</Badge>;
}

function SourceQuote({
  source,
  href,
}: {
  source: NonNullable<
    ReturnType<typeof useItemKnowledge>["knowledge"]["source"]
  >;
  href: (space: Space, page: SpacePage) => string;
}) {
  const at = `${href(source.space, source.page)}?commit=${source.commitId}${
    source.blockId ? `#block-${source.blockId}` : ""
  }`;
  return (
    <figure className="mb-3 rounded-lg bg-muted/50 px-3 py-2.5 text-[13px]">
      <figcaption className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        <Quote className="size-3.5" aria-hidden />
        <span>
          Created from{" "}
          <span className="font-medium text-foreground">
            {source.page.title}
          </span>{" "}
          · {source.space.name}
        </span>
        <Link
          href={at}
          className="ml-auto font-medium text-foreground underline-offset-2 hover:underline"
        >
          Open source
        </Link>
      </figcaption>
      {source.quote && (
        <blockquote className="mt-2 line-clamp-4 border-l-2 border-foreground/15 pl-3 whitespace-pre-line text-foreground/85">
          {source.quote}
        </blockquote>
      )}
    </figure>
  );
}

// The versions an item relies on (its attachment's pin and the pins its
// current revision cites), and the one the row's title opens when there is
// exactly one.
const pinsOf = ({ attachment, citation }: ItemKnowledgePage) => [
  ...new Set([
    ...(attachment?.commitId ? [attachment.commitId] : []),
    ...(citation?.current?.commitIds ?? []),
  ]),
];
const pinnedVersion = (entry: ItemKnowledgePage) => {
  const pins = pinsOf(entry);
  return pins.length === 1 ? pins[0] : undefined;
};

function KnowledgeRow({
  entry,
  itemKey,
  revisionNumber,
  details,
  href,
  onDetach,
}: {
  entry: ItemKnowledgePage;
  itemKey: string;
  revisionNumber: number;
  details: PageLinkDetails | undefined;
  href: string;
  onDetach?: () => void;
}) {
  const { page, space, mention, attachment, citation } = entry;
  const title = page.title || "Untitled";
  // Every version this item relies on is its own link: a pin never hides
  // behind a mention, and a mention never opens an older version.
  const versionLink = (commitId: string) => {
    const n = details?.versions[commitId];
    return (
      <Link
        key={commitId}
        href={`${href}?commit=${commitId}`}
        className="relative z-10 rounded-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        {n ? `v${n}` : "pinned version"}
        <span className="sr-only">
          : open {n ? `version ${n}` : "that version"} of “{title}”
        </span>
      </Link>
    );
  };
  const list = (ids: string[]) =>
    [...new Set(ids)].flatMap((id, i) =>
      i
        ? [<Fragment key={`sep-${id}`}>, </Fragment>, versionLink(id)]
        : [versionLink(id)],
    );
  const block = details?.blocks[0];
  const facts: React.ReactNode[] = [];
  if (mention)
    facts.push(
      <>
        <Link
          href={`${href}#block-${mention.blockIds[0]}`}
          title={`Opens the latest version of “${title}” where it mentions ${itemKey}`}
          className="relative z-10 rounded-sm font-medium text-foreground underline decoration-foreground/30 underline-offset-2 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Mentioned in latest
        </Link>
        {block?.heading
          ? ` under “${block.heading}”`
          : mention.blockIds.length > 1
            ? ` in ${mention.blockIds.length} places`
            : ""}
      </>,
    );
  if (attachment?.commitId)
    facts.push(<>Attached at {versionLink(attachment.commitId)}</>);
  if (citation?.current) {
    const pins = citation.current.commitIds;
    facts.push(
      pins.length ? (
        <>
          Revision {citation.current.number} cites {list(pins)}
          {citation.current.latest ? " and the latest" : ""}
        </>
      ) : (
        `Cited by revision ${citation.current.number}`
      ),
    );
  } else if (citation?.earlier)
    facts.push(
      `Cited by revision ${citation.earlier.number}, not by the current revision ${revisionNumber}`,
    );
  // The title opens the version the item relies on: its one pin, the
  // latest otherwise (at the mention, when there is one).
  const pins = pinsOf(entry);
  const pinned = pinnedVersion(entry);
  const target = pinned
    ? `${href}?commit=${pinned}`
    : mention
      ? `${href}#block-${mention.blockIds[0]}`
      : href;
  const targetVersion = pinned ? details?.versions[pinned] : undefined;
  const newerPin = entry.newer
    ? pins.find((id) => id !== page.publishedCommitId)
    : undefined;
  // An excerpt says which version it quotes when the row also speaks of an
  // older pinned one: the mention is the latest version's text, and the
  // pinned version's own words in that place follow when they differ.
  const olderPin = pins.some((id) => id !== mention?.commitId);
  const pinnedBlock =
    pinned && pinned !== mention?.commitId
      ? (details?.pinnedBlocks?.find((b) => b.blockId === block?.blockId) ??
        details?.pinnedBlocks?.[0])
      : undefined;
  const pinnedExcerpt =
    pinnedBlock?.excerpt && pinnedBlock.excerpt !== block?.excerpt
      ? pinnedBlock.excerpt
      : undefined;
  return (
    <li className="group relative flex items-start gap-2.5 border-b px-3 py-2.5 text-[13px] last:border-b-0 hover:bg-muted/50">
      {attachment ? (
        <Paperclip
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      ) : (
        <FileText
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={target}
            title={
              pinned
                ? `Opens ${targetVersion ? `version ${targetVersion}` : "the pinned version"}`
                : "Opens the latest version"
            }
            className="min-w-0 truncate font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
          >
            {title}
          </Link>
          {attachment && <Badge>{purposeLabels[attachment.purpose]}</Badge>}
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {space.name}
          </span>
        </div>
        {facts.length > 0 && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {facts.map((fact, i) => (
              <Fragment key={i}>
                {i > 0 && " · "}
                {fact}
              </Fragment>
            ))}
          </p>
        )}
        {block?.excerpt && (
          <p className="mt-1 line-clamp-2 text-xs text-foreground/75">
            {olderPin && (
              <span className="font-medium text-muted-foreground">
                Latest mention:{" "}
              </span>
            )}
            “{block.excerpt}”
          </p>
        )}
        {pinnedExcerpt && (
          <p className="mt-1 line-clamp-2 text-xs text-foreground/75">
            <span className="font-medium text-muted-foreground">
              {targetVersion ? `v${targetVersion}` : "Pinned version"}{" "}
              (pinned):{" "}
            </span>
            “{pinnedExcerpt}”
          </p>
        )}
        {newerPin && (
          <p className="mt-1 text-xs text-muted-foreground">
            Newer version
            {details ? ` v${details.publishedVersion}` : ""} published ·{" "}
            <Link
              href={`${href}/history?view=versions&version=${page.publishedCommitId}&compare=${newerPin}`}
              className="relative z-10 font-medium text-foreground underline-offset-2 hover:underline"
            >
              Compare
            </Link>
          </p>
        )}
      </div>
      {onDetach && (
        <button
          type="button"
          aria-label={`Detach “${page.title}”`}
          title="Detach"
          className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 touch:opacity-100"
          onClick={onDetach}
        >
          <X className="size-3.5" />
        </button>
      )}
    </li>
  );
}

// Finding the page is a popover; choosing its purpose and pin happens in
// the section, above the list, so no row it may be about is hidden.
function AttachPage({
  itemKey,
  exclude,
  first,
  onChoose,
}: {
  itemKey: string;
  exclude: ReadonlySet<string>;
  first: ReadonlyMap<string, string>;
  onChoose: (choice: PageChoice) => void;
}) {
  return (
    <Popover
      width={340}
      align="end"
      trigger={(props) => (
        <Button {...props} variant="ghost" size="sm">
          <Plus className="size-3.5" aria-hidden /> Attach page
        </Button>
      )}
    >
      {() => (
        <PagePicker
          title={`Attach a page to ${itemKey}`}
          exclude={exclude}
          first={first}
          onSelect={onChoose}
        />
      )}
    </Popover>
  );
}

const purposeHints: Record<PageAttachmentPurpose, string> = {
  background: "Context worth reading first",
  design: "How it is meant to look or work",
  runbook: "How to operate or support it",
};

function AttachForm({
  item,
  itemKey,
  choice,
  onBack,
  onDone,
}: {
  item: WorkItem;
  itemKey: string;
  choice: PageChoice;
  onBack: () => void;
  onDone: () => void;
}) {
  const labelId = useId();
  const { mutateConfirmed } = useWorkspace();
  const [purpose, setPurpose] = useState<PageAttachmentPurpose>("background");
  const [pin, setPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = useId();
  return (
    <form
      aria-labelledby={labelId}
      className="mb-3 flex flex-col gap-3 rounded-lg border bg-card p-3 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(undefined);
        mutateConfirmed({
          type: "attachPage",
          workItemId: item.id,
          attachmentId: crypto.randomUUID(),
          pageId: choice.page.id,
          purpose,
          commitId: pin ? choice.page.publishedCommitId : null,
        })
          .then(onDone)
          .catch((err: unknown) => {
            setError(errorText(err));
            setBusy(false);
          });
      }}
    >
      <h2 id={labelId} className="text-sm font-semibold">
        Attach “{choice.page.title}” to {itemKey}
      </h2>
      <fieldset className="space-y-1">
        <legend className="mb-1 text-xs text-muted-foreground">Purpose</legend>
        {pageAttachmentPurposes.map((p) => (
          <label
            key={p}
            className={cn(
              "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted",
              purpose === p && "bg-muted",
            )}
          >
            <input
              type="radio"
              name={name}
              value={p}
              checked={purpose === p}
              onChange={() => setPurpose(p)}
              className="mt-0.5"
              // Focus lands on the chosen purpose when the step opens.
              autoFocus={purpose === p}
            />
            <span>
              <span className="block font-medium">{purposeLabels[p]}</span>
              <span className="block text-xs text-muted-foreground">
                {purposeHints[p]}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2 px-2 text-xs">
        <input
          type="checkbox"
          checked={pin}
          onChange={(e) => setPin(e.target.checked)}
          className="mt-0.5"
        />
        <span>
          Pin the version published now
          <span className="block text-muted-foreground">
            Otherwise the item follows the page as it is published.
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Attaching…" : "Attach page"}
        </Button>
      </div>
    </form>
  );
}

function ProposePageUpdate({
  item,
  itemKey,
  first,
}: {
  item: WorkItem;
  itemKey: string;
  first: ReadonlyMap<string, string>;
}) {
  const { index, levelOf } = useSpaces();
  const [choice, setChoice] = useState<PageChoice>();
  // A branch needs edit access to the page's space.
  const canEditSomewhere = index.spaces.some(
    (s) => !s.archivedAt && levelOf(s.id) === "edit",
  );
  if (!canEditSomewhere) return null;
  return (
    <Popover
      width={360}
      align="end"
      onOpenChange={(open) => !open && setChoice(undefined)}
      trigger={(props) => (
        <Button {...props} variant="ghost" size="sm">
          <FilePen className="size-3.5" aria-hidden /> Propose page update
        </Button>
      )}
    >
      {(close) =>
        choice ? (
          <ProposeForm
            item={item}
            itemKey={itemKey}
            choice={choice}
            onBack={() => setChoice(undefined)}
            onDone={close}
          />
        ) : (
          <PagePicker
            title="Propose an update to"
            keepOpen
            editable
            first={first}
            onSelect={setChoice}
          />
        )
      }
    </Popover>
  );
}

// "pay-2-retry-failed-card-captures", short enough to read, and not a name
// already in use on the page.
export function suggestedBranchName(
  itemKey: string,
  title: string,
  taken: ReadonlySet<string> = new Set(),
) {
  const words = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const root = finalizeBranchName(
    `${itemKey.toLowerCase()}-${words}`.slice(0, 44),
  );
  if (!taken.has(root)) return root;
  for (let n = 2; ; n += 1)
    if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
}

function ProposeForm({
  item,
  itemKey,
  choice,
  onBack,
  onDone,
}: {
  item: WorkItem;
  itemKey: string;
  choice: PageChoice;
  onBack: () => void;
  onDone: () => void;
}) {
  const labelId = usePopover()?.labelId;
  const router = useRouter();
  const { organization, mutateConfirmed } = useWorkspace();
  const { branches } = usePageHistory(choice.page.id);
  const titleId = useId();
  const nameId = useId();
  // What the change is leads; the branch is named after it unless the
  // person names it themselves (Advanced).
  const [title, setTitle] = useState("");
  const [customName, setCustomName] = useState<string>();
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{
    field: "title" | "name";
    text: string;
  }>();
  const taken = useMemo(
    () => new Set(branches.map((b) => b.name.toLowerCase())),
    [branches],
  );
  const derived = suggestedBranchName(
    itemKey,
    title.trim() || item.title,
    taken,
  );
  const name = customName ?? derived;
  const reviewed = choice.space.publishing === "reviewed";
  const describedBy = (field: "title" | "name", hint?: string) =>
    [hint, error?.field === field ? `${titleId}-error` : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <form
      className="flex flex-col gap-2.5 p-3 text-[13px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        const change = title.trim();
        if (!change)
          return setError({
            field: "title",
            text: "Say what the change is, so it can be told apart from other updates.",
          });
        const final = finalizeBranchName(name);
        const problem = branchNameProblem(final);
        if (problem) {
          setAdvanced(true);
          return setError({ field: "name", text: `Branch name: ${problem}` });
        }
        setBusy(true);
        setError(undefined);
        const branchId = crypto.randomUUID();
        mutateConfirmed({
          type: "createPageBranch",
          pageId: choice.page.id,
          branchId,
          name: final,
          origin: {
            workItemId: item.id,
            revisionId: item.revisionId,
            title: change,
          },
        })
          .then(() => {
            onDone();
            router.push(
              `${paths.spacePage(organization.slug, choice.space.slug, choice.page.id)}?branch=${branchId}`,
            );
          })
          .catch((err: unknown) => {
            const text = errorText(err);
            const aboutName = /branch name/i.test(text);
            if (aboutName) setAdvanced(true);
            setError({ field: aboutName ? "name" : "title", text });
            setBusy(false);
          });
      }}
    >
      <h2 id={labelId} className="text-sm font-semibold">
        Propose an update to “{choice.page.title}”
      </h2>
      <p id={`${titleId}-hint`} className="text-xs text-muted-foreground">
        A branch of the page opens in the editor, linked to {itemKey} revision{" "}
        {item.revisionNumber}.{" "}
        {reviewed
          ? "Its changes are published after review."
          : "Nothing is published until you merge it."}
      </p>
      <label htmlFor={titleId} className="text-xs font-medium">
        What changes
      </label>
      <input
        id={titleId}
        autoFocus
        value={title}
        maxLength={200}
        placeholder="Document the finance approval time"
        onChange={(e) => {
          setTitle(e.target.value);
          if (error?.field === "title") setError(undefined);
        }}
        aria-invalid={error?.field === "title" || undefined}
        aria-describedby={describedBy("title", `${titleId}-hint`)}
        className="h-8 w-full rounded-md border bg-background px-2 text-[13px] outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring/60 touch:text-base"
      />
      <details
        open={advanced}
        onToggle={(e) => setAdvanced(e.currentTarget.open)}
        className="group text-xs"
      >
        <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60">
          Advanced
          {!advanced && (
            <span className="ml-1.5 font-mono text-[11px]">
              · branch {name}
            </span>
          )}
        </summary>
        <div className="mt-2 flex flex-col gap-1.5">
          <label htmlFor={nameId} className="font-medium">
            Branch name
          </label>
          <input
            id={nameId}
            value={name}
            maxLength={80}
            onChange={(e) => {
              setCustomName(sanitizeBranchNameInput(e.target.value));
              if (error?.field === "name") setError(undefined);
            }}
            aria-invalid={error?.field === "name" || undefined}
            aria-describedby={describedBy("name")}
            className="h-8 w-full rounded-md border bg-background px-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60 touch:text-base"
          />
        </div>
      </details>
      {error && (
        <p
          id={`${titleId}-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {error.text}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Opening…" : "Create branch and edit"}
        </Button>
      </div>
    </form>
  );
}
