import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { Check, Loader2, Plus, UserMinus } from "lucide-react";
import {
  spaceAccessLevels,
  spaceLevelAtLeast,
  type Command,
  type Directory,
  type SpaceAccessLevel,
  type SpaceAccessMode,
  type SpacePublishing,
} from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Popover } from "@lictory/ui/popover";
import { Tooltip } from "@lictory/ui/tooltip";
import { Avatar, Badge } from "@lictory/ui/primitives";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useRouter } from "@lictory/platform/lib/navigation";
import {
  slugPattern,
  type Space,
  type SpaceGrant,
} from "@lictory/platform/data/spaces";
import { PeoplePicker } from "@lictory/platform/components/ui/people-picker";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsGroup,
} from "@lictory/platform/components/workspace/settings-section";
import {
  useSpaceGrants,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { SpaceBreadcrumbs } from "@lictory/platform/components/spaces/breadcrumbs";
import {
  Dialog,
  SegmentedChoice,
} from "@lictory/platform/components/spaces/dialog";
import {
  HomeFields,
  IconPicker,
  homeChoice,
  type HomeChoice,
} from "@lictory/platform/components/spaces/space-fields";
import {
  SpaceIcon,
  homeOf,
  inheritedAccess,
  levelLabels,
  publishingDescriptions,
  type SpaceHome,
} from "@lictory/platform/components/spaces/space-meta";

// Every setting saves the same way: as soon as it changes (text when the
// field is left or Enter is pressed), with its state beside it: "Saving…",
// then "Saved", or the server's refusal underneath. Settings are decisions
// the server confirms before they show: nothing here is predicted. Changes
// that take access away ask first.

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function useSaving() {
  const { mutateConfirmed } = useWorkspace();
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  useEffect(() => {
    if (state.kind !== "saved") return;
    const timer = window.setTimeout(() => setState({ kind: "idle" }), 2500);
    return () => window.clearTimeout(timer);
  }, [state]);
  const run = useCallback(
    async (command: Command) => {
      setState({ kind: "saving" });
      try {
        await mutateConfirmed(command);
        setState({ kind: "saved" });
        return true;
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "The change was not saved.",
        });
        return false;
      }
    },
    [mutateConfirmed],
  );
  return {
    run,
    state,
    pending: state.kind === "saving",
    error: state.kind === "error" ? state.message : undefined,
  };
}

// Beside a setting's label: whether its last change is being saved or was.
function SaveStatus({ state }: { state: SaveState }) {
  return (
    <span
      role="status"
      className="inline-flex h-5 shrink-0 items-center gap-1 text-xs text-muted-foreground"
    >
      {state.kind === "saving" && (
        <>
          <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden />
          Saving…
        </>
      )}
      {state.kind === "saved" && (
        <>
          <Check className="size-3 text-success" aria-hidden />
          Saved
        </>
      )}
    </span>
  );
}

// A field's text while it is being edited, following the server's value
// whenever the person has not changed it.
function useServerDraft<T>(value: T) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (!Object.is(value, base)) {
    setBase(value);
    if (Object.is(draft, base)) setDraft(value);
  }
  return [draft, setDraft] as const;
}

export function SpaceSettings() {
  const space = useSpace();
  const { levelOf, canManageSpace } = useSpaces();
  const canEditDetails =
    spaceLevelAtLeast(levelOf(space.id), "edit") && !space.archivedAt;
  const manage = canManageSpace(space);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pt-5 pb-16 sm:px-8 sm:pt-7">
        <SpaceBreadcrumbs space={space} />
        <header className="mt-4 flex items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
            <SpaceIcon space={space} className="size-5 text-lg" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">
              Space settings
            </h1>
            {(manage || canEditDetails) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Changes save as you make them.
              </p>
            )}
          </div>
        </header>
        {!manage && (
          <div className="mt-5">
            <ReadOnlyNotice>
              {canEditDetails
                ? "You can change the details. The space’s administrators decide its location, publishing and access."
                : "You can view these settings. Ask an administrator of this space to change them."}
            </ReadOnlyNotice>
          </div>
        )}
        <div className="mt-8 space-y-9">
          <DetailsSection space={space} canEdit={canEditDetails} />
          <LocationSection
            space={space}
            canEdit={manage && !space.archivedAt}
          />
          <AccessSection space={space} canEdit={manage && !space.archivedAt} />
          <ArchiveSection space={space} canEdit={manage} />
        </div>
      </div>
    </div>
  );
}

// One group of settings: a quiet label over a card whose rows are divided
// by hairlines.
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-clip rounded-xl border border-transparent bg-card shadow-(--shadow-border)">
      {children}
    </div>
  );
}

// A labelled setting with its save state on the label's line.
function Setting({
  label,
  htmlFor,
  optional,
  status,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  status: SaveState;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={htmlFor} className="text-xs font-medium">
          {label}
          {optional && (
            <span className="font-normal text-muted-foreground">
              {" "}
              (optional)
            </span>
          )}
        </label>
        <SaveStatus state={status} />
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <InlineError>{error}</InlineError>
    </div>
  );
}

const field =
  "border-foreground/15 focus-visible:border-ring/60 disabled:opacity-60";

function DetailsSection({
  space,
  canEdit,
}: {
  space: Space;
  canEdit: boolean;
}) {
  const { organization } = useWorkspace();
  const router = useRouter();
  const nameSave = useSaving();
  const slugSave = useSaving();
  const descriptionSave = useSaving();
  const ids = { name: useId(), slug: useId(), description: useId() };
  const [name, setName] = useServerDraft(space.name);
  const [slug, setSlug] = useServerDraft(space.slug);
  const [description, setDescription] = useServerDraft(space.description ?? "");
  const slugValid = slugPattern.test(slug);
  const saveName = () => {
    const next = name.trim();
    if (!next) return setName(space.name);
    if (next !== space.name)
      void nameSave.run({ type: "updateSpace", spaceId: space.id, name: next });
  };
  const saveSlug = async () => {
    if (!slugValid || slug === space.slug) return;
    const ok = await slugSave.run({
      type: "updateSpace",
      spaceId: space.id,
      slug,
    });
    if (ok) router.replace(paths.spaceSettings(organization.slug, slug));
  };
  const saveDescription = () => {
    const next = description.trim();
    if (next !== (space.description ?? ""))
      void descriptionSave.run({
        type: "updateSpace",
        spaceId: space.id,
        description: next || null,
      });
  };
  // Enter saves a one-line field (by leaving it), Escape puts it back.
  const keys =
    (revert: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
      } else if (e.key === "Escape") {
        revert();
        e.currentTarget.blur();
      }
    };
  return (
    <SettingsGroup title="Details">
      <Panel>
        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Setting
              label="Name"
              htmlFor={ids.name}
              status={nameSave.state}
              error={nameSave.error}
            >
              <div className="flex items-center gap-2">
                <IconPicker
                  value={space.icon}
                  onChange={(icon) =>
                    void nameSave.run({
                      type: "updateSpace",
                      spaceId: space.id,
                      icon,
                    })
                  }
                  disabled={!canEdit}
                  className={cn("size-9 text-lg", field)}
                />
                <Input
                  id={ids.name}
                  value={name}
                  maxLength={120}
                  disabled={!canEdit}
                  className={cn("h-9 text-sm", field)}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={saveName}
                  onKeyDown={keys(() => setName(space.name))}
                />
              </div>
            </Setting>
            <Setting
              label="Address"
              htmlFor={ids.slug}
              status={slugSave.state}
              error={slugSave.error}
              hint={
                slugValid ? (
                  `/${organization.slug}/spaces/${slug}`
                ) : (
                  <span className="text-destructive">
                    Use lowercase letters, digits and single hyphens.
                  </span>
                )
              }
            >
              <Input
                id={ids.slug}
                value={slug}
                maxLength={60}
                disabled={!canEdit}
                className={cn("h-9 text-sm", field)}
                aria-invalid={!slugValid}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                onBlur={() => void saveSlug()}
                onKeyDown={keys(() => setSlug(space.slug))}
              />
            </Setting>
          </div>
          <Setting
            label="Description"
            htmlFor={ids.description}
            optional
            status={descriptionSave.state}
            error={descriptionSave.error}
          >
            <textarea
              id={ids.description}
              value={description}
              maxLength={2000}
              rows={2}
              disabled={!canEdit}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={saveDescription}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDescription(space.description ?? "");
                  e.currentTarget.blur();
                }
              }}
              className={cn(
                "w-full resize-y rounded-xl border bg-card px-3.5 py-2 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/15 touch:text-base",
                field,
              )}
            />
          </Setting>
        </div>
      </Panel>
    </SettingsGroup>
  );
}

function LocationSection({
  space,
  canEdit,
}: {
  space: Space;
  canEdit: boolean;
}) {
  const { organization, directory } = useWorkspace();
  const location = useSaving();
  const publishing = useSaving();
  const [moving, setMoving] = useState<HomeChoice>();
  const current = homeChoice(space.projectId, space.teamId);
  const move = (home: HomeChoice) =>
    void location.run({
      type: "updateSpace",
      spaceId: space.id,
      home: home.projectId
        ? home.teamId
          ? { projectId: home.projectId, teamId: home.teamId }
          : { projectId: home.projectId }
        : {},
    });
  const next = moving && homeOf(moving, directory, organization.name);
  return (
    <SettingsGroup title="Location & publishing">
      <Panel>
        <div className="space-y-1 px-4 py-3.5">
          <HomeFields
            inline
            value={current}
            disabled={!canEdit || location.pending}
            status={<SaveStatus state={location.state} />}
            onChange={(home) => {
              if (
                home.projectId === space.projectId &&
                home.teamId === space.teamId
              )
                return;
              // While access is inherited, the location decides who edits.
              if (space.accessMode === "inherited") setMoving(home);
              else move(home);
            }}
            hint="Where the space is listed. While access is inherited, the location’s members can edit."
          />
          <InlineError>{location.error}</InlineError>
        </div>
        <div className="space-y-1 px-4 py-3.5">
          <SegmentedChoice<SpacePublishing>
            label="Publishing"
            name="space-publishing-setting"
            value={space.publishing}
            disabled={!canEdit || publishing.pending}
            status={<SaveStatus state={publishing.state} />}
            onChange={(value) =>
              void publishing.run({
                type: "updateSpace",
                spaceId: space.id,
                publishing: value,
              })
            }
            options={[
              {
                value: "direct",
                label: "Direct",
                description: publishingDescriptions.direct,
              },
              {
                value: "reviewed",
                label: "Reviewed",
                description: publishingDescriptions.reviewed,
              },
            ]}
          />
          <InlineError>{publishing.error}</InlineError>
        </div>
      </Panel>
      {moving && next && (
        <Dialog
          title={`Move ${space.name} to ${next.label}?`}
          description={`It will be listed under ${next.label}, and its access follows: ${inheritedAccess(next, organization.name)}`}
          onClose={() => setMoving(undefined)}
          width="max-w-md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setMoving(undefined)}>
                Cancel
              </Button>
              <Button
                data-autofocus
                onClick={() => {
                  setMoving(undefined);
                  move(moving);
                }}
              >
                Move space
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-muted-foreground">
            People with named access keep it.
          </p>
        </Dialog>
      )}
    </SettingsGroup>
  );
}

// The level a person has from the location while access is inherited:
// members of the location edit, everyone else in the organization views.
// Mirrors the server's rule for display; the server decides.
function inheritedLevel(
  space: Space,
  directory: Pick<Directory, "members" | "projectMembers" | "teams">,
  userId: string,
): SpaceAccessLevel | null {
  if (space.accessMode === "restricted") return null;
  if (!directory.members.some((m) => m.id === userId)) return null;
  if (space.teamId)
    return directory.teams
      .find((t) => t.id === space.teamId)
      ?.memberIds.includes(userId)
      ? "edit"
      : "view";
  if (space.projectId)
    return directory.projectMembers.some(
      (m) => m.projectId === space.projectId && m.userId === userId,
    )
      ? "edit"
      : "view";
  return "edit";
}

const rank = (level: SpaceAccessLevel | null) =>
  level ? spaceAccessLevels.indexOf(level) : -1;

function inheritedSource(
  level: SpaceAccessLevel,
  home: SpaceHome,
  organizationName: string,
) {
  if (level === "view") return `as everyone in ${organizationName}`;
  if (home.kind === "team") return `member of the ${home.teamName} team`;
  if (home.kind === "project") return `member of ${home.projectName}`;
  return `member of ${organizationName}`;
}

function AccessSection({ space, canEdit }: { space: Space; canEdit: boolean }) {
  const { organization, directory, isAdmin } = useWorkspace();
  const grants = useSpaceGrants(space.id);
  const mode = useSaving();
  const adding = useSaving();
  const [confirmRestrict, setConfirmRestrict] = useState(false);
  const home = homeOf(space, directory, organization.name);
  const people = grants
    .map((g) => ({
      grant: g,
      member: directory.members.find((m) => m.id === g.userId),
    }))
    .sort((a, b) => (a.member?.name ?? "").localeCompare(b.member?.name ?? ""));
  const switchMode = (accessMode: SpaceAccessMode) => {
    if (accessMode === space.accessMode) return;
    if (accessMode === "restricted") setConfirmRestrict(true);
    else
      void mode.run({
        type: "setSpaceAccessMode",
        spaceId: space.id,
        accessMode,
      });
  };
  return (
    <SettingsGroup title="Access">
      <Panel>
        <div className="space-y-1 px-4 py-3.5">
          <SegmentedChoice<SpaceAccessMode>
            label="Access mode"
            name="space-access-setting"
            value={space.accessMode}
            disabled={!canEdit || mode.pending}
            status={<SaveStatus state={mode.state} />}
            onChange={switchMode}
            options={[
              {
                value: "inherited",
                label: "Inherited",
                description: inheritedAccess(home, organization.name),
              },
              {
                value: "restricted",
                label: "Restricted",
                description:
                  "Only people with named access can open it. Switching back keeps them.",
              },
            ]}
          />
          <InlineError>{mode.error}</InlineError>
        </div>
        <div>
          <div className="flex min-h-12 items-center gap-3 px-4 py-2">
            <h3 className="mr-auto text-xs font-medium">
              Named access
              {people.length > 0 && (
                <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
                  {people.length}
                </span>
              )}
            </h3>
            <SaveStatus state={adding.state} />
            {canEdit && (
              <Popover
                width={280}
                align="end"
                trigger={(props) => (
                  <Button {...props} size="sm" variant="secondary">
                    <Plus className="size-3.5" aria-hidden /> Add people
                  </Button>
                )}
              >
                <PeoplePicker
                  title="Give access"
                  excludeIds={grants.map((g) => g.userId)}
                  onSelect={(id) =>
                    void adding.run({
                      type: "setSpaceGrant",
                      spaceId: space.id,
                      userId: id,
                      level: "view",
                    })
                  }
                />
              </Popover>
            )}
          </div>
          {adding.error && (
            <div className="px-4 pb-3">
              <InlineError>{adding.error}</InlineError>
            </div>
          )}
          {people.length === 0 ? (
            <p className="px-4 pb-4 text-xs text-muted-foreground">
              {space.accessMode === "restricted"
                ? "Nobody has named access yet."
                : "Nobody yet. Everyone gets access from the location."}
            </p>
          ) : (
            <ul className="divide-y divide-border border-t">
              {people.map(({ grant, member }) => (
                <GrantRow
                  key={grant.id}
                  space={space}
                  grant={grant}
                  name={member?.name ?? "Former member"}
                  email={member?.email}
                  image={member?.image}
                  home={home}
                  canEdit={canEdit}
                />
              ))}
            </ul>
          )}
        </div>
      </Panel>
      {(isAdmin || canEdit) && (
        <p className="px-1 text-xs leading-5 text-muted-foreground">
          Administrators can manage access without reading the space. Access
          they grant themselves is audited.
        </p>
      )}
      {confirmRestrict && (
        <Dialog
          title={`Restrict ${space.name}?`}
          description={`Only people with named access will be able to open it. Members of ${home.label} lose access unless they are named. You keep edit access.`}
          onClose={() => setConfirmRestrict(false)}
          width="max-w-md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmRestrict(false)}>
                Cancel
              </Button>
              <Button
                data-autofocus
                disabled={mode.pending}
                onClick={() => {
                  setConfirmRestrict(false);
                  void mode.run({
                    type: "setSpaceAccessMode",
                    spaceId: space.id,
                    accessMode: "restricted",
                  });
                }}
              >
                Restrict access
              </Button>
            </>
          }
        >
          <p className="text-[13px] text-muted-foreground">
            {people.length === 0
              ? "Nobody else has named access yet. Add people after restricting."
              : `${people.length === 1 ? "1 person keeps" : `${people.length} people keep`} their named access.`}
          </p>
        </Dialog>
      )}
    </SettingsGroup>
  );
}

// One person with named access: what they can do in the end and why
// ("Can edit · member of Payments", "Can comment · named access"), the
// named level, and removing it with what remains said beforehand.
function GrantRow({
  space,
  grant,
  name,
  email,
  image,
  home,
  canEdit,
}: {
  space: Space;
  grant: SpaceGrant;
  name: string;
  email?: string;
  image?: string | null;
  home: SpaceHome;
  canEdit: boolean;
}) {
  const { organization, directory, userId } = useWorkspace();
  const save = useSaving();
  const inherited = inheritedLevel(space, directory, grant.userId);
  const named = rank(grant.level) > rank(inherited);
  const effective = named ? grant.level : inherited!;
  const source = named
    ? "named access"
    : inheritedSource(effective, home, organization.name);
  const without = !named
    ? `${name} keeps “${levelLabels[effective]}” ${source}.`
    : inherited
      ? `Without it, ${name} can only view.`
      : `Without it, ${name} loses access.`;
  const set = (level: SpaceAccessLevel | null) =>
    void save.run({
      type: "setSpaceGrant",
      spaceId: space.id,
      userId: grant.userId,
      level,
    });
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-[13px]">
      <Avatar image={image} name={name} size="md" />
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 font-medium">
            {name}
            {grant.userId === userId && (
              <span className="font-normal text-muted-foreground"> (you)</span>
            )}
          </span>
          {email && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {email}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {levelLabels[effective]}
          </span>{" "}
          · {source}
          {named && (
            <> ({inherited ? "otherwise can view" : "their only access"})</>
          )}
        </p>
        <InlineError>{save.error}</InlineError>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {grant.userId === userId && grant.grantedById === userId && (
          <Badge tone="info">Self-granted · audited</Badge>
        )}
        <SaveStatus state={save.state} />
        <DropdownSelect
          size="sm"
          className={cn("w-32", field)}
          aria-label={`Named access of ${name}`}
          disabled={!canEdit || save.pending}
          value={grant.level}
          onValueChange={(value) => set(value as SpaceAccessLevel)}
        >
          {(["view", "comment", "edit"] as const).map((level) => (
            <DropdownSelectOption key={level} value={level}>
              {levelLabels[level]}
            </DropdownSelectOption>
          ))}
        </DropdownSelect>
        {canEdit && (
          <Tooltip label={`Remove named access. ${without}`}>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Remove ${name}’s named access`}
              aria-description={without}
              disabled={save.pending}
              onClick={() => set(null)}
            >
              <UserMinus className="size-4" aria-hidden />
            </Button>
          </Tooltip>
        )}
      </div>
    </li>
  );
}

function ArchiveSection({
  space,
  canEdit,
}: {
  space: Space;
  canEdit: boolean;
}) {
  const save = useSaving();
  const archived = Boolean(space.archivedAt);
  return (
    <SettingsGroup title="Archive">
      <Panel>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5">
          <div className="min-w-0 flex-1 basis-56">
            <p className="text-xs font-medium">
              {archived ? "This space is archived" : "Archive this space"}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {archived
                ? "Hidden from navigation, its pages frozen. Restoring brings everything back."
                : "Hides it from navigation and freezes its pages. Nothing is deleted."}
            </p>
          </div>
          <SaveStatus state={save.state} />
          {canEdit && (
            <Button
              size="sm"
              variant="secondary"
              disabled={save.pending}
              onClick={() =>
                void save.run({
                  type: "archiveSpace",
                  spaceId: space.id,
                  archived: !archived,
                })
              }
            >
              {archived ? "Restore space" : "Archive space"}
            </Button>
          )}
        </div>
        {save.error && (
          <div className="px-4 py-3">
            <InlineError>{save.error}</InlineError>
          </div>
        )}
      </Panel>
    </SettingsGroup>
  );
}
