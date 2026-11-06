import { useId, useState } from "react";
import { Archive, FileText, Home, KeyRound, Plus } from "lucide-react";
import {
  spaceLevelAtLeast,
  type Command,
  type SpaceAccessLevel,
  type SpaceAccessMode,
  type SpacePublishing,
} from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Popover } from "@lictory/ui/popover";
import { Avatar, Badge } from "@lictory/ui/primitives";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import { useRouter } from "@lictory/platform/lib/navigation";
import { slugPattern, type Space } from "@lictory/platform/data/spaces";
import { PeoplePicker } from "@lictory/platform/components/ui/people-picker";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import {
  useSpaceGrants,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { useSpace } from "@lictory/platform/components/spaces/space-gate";
import { SpaceBreadcrumbs } from "@lictory/platform/components/spaces/breadcrumbs";
import {
  Dialog,
  Field,
  SegmentedChoice,
} from "@lictory/platform/components/spaces/dialog";
import {
  HomeFields,
  IconField,
  homeChoice,
  type HomeChoice,
} from "@lictory/platform/components/spaces/space-fields";
import {
  SpaceIcon,
  homeOf,
  inheritedAccess,
  levelLabels,
  publishingDescriptions,
} from "@lictory/platform/components/spaces/space-meta";

// Settings changes are decisions the server confirms before they show:
// nothing here is predicted, and refusals appear where they happened.
function useConfirmed() {
  const { mutateConfirmed } = useWorkspace();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const run = async (command: Command) => {
    setPending(true);
    setError(undefined);
    try {
      await mutateConfirmed(command);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change was not saved.");
      return false;
    } finally {
      setPending(false);
    }
  };
  return { run, error, pending };
}

export function SpaceSettings() {
  const space = useSpace();
  const { levelOf, canManageSpace } = useSpaces();
  const canEditDetails =
    spaceLevelAtLeast(levelOf(space.id), "edit") && !space.archivedAt;
  const manage = canManageSpace(space);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 px-4 pt-5 pb-16 sm:px-8 sm:pt-7">
        <div>
          <SpaceBreadcrumbs space={space} />
          <header className="mt-6 flex items-center gap-3.5">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted shadow-(--shadow-border)">
              <SpaceIcon space={space} className="size-6 text-xl" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight">
                Space settings
              </h1>
              <p className="text-[13px] text-muted-foreground">
                Editors change the details. Administrators of the space decide
                its home, publishing, access and archiving.
              </p>
            </div>
          </header>
        </div>
        {!manage && !canEditDetails && (
          <ReadOnlyNotice>
            You can view these settings. Ask an administrator of this space to
            change them.
          </ReadOnlyNotice>
        )}
        {/* Re-read after every confirmed change (by anyone). */}
        <DetailsSection
          key={`details:${space.updatedAt}`}
          space={space}
          canEdit={canEditDetails}
        />
        <HomeSection
          key={`home:${space.updatedAt}`}
          space={space}
          canEdit={manage && !space.archivedAt}
        />
        <AccessSection space={space} canEdit={manage && !space.archivedAt} />
        <ArchiveSection space={space} canEdit={manage} />
      </div>
    </div>
  );
}

// Appears once something changed: what is saved stays obvious, and a
// pristine form shows no disabled button.
function SaveBar({
  pending,
  canSave,
  onDiscard,
  submit,
  onSave,
}: {
  pending: boolean;
  canSave: boolean;
  onDiscard: () => void;
  // Submits the surrounding form (Enter in a field does the same).
  submit?: boolean;
  onSave?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/40 px-5 py-2.5">
      <span className="mr-auto text-xs text-muted-foreground">
        Unsaved changes
      </span>
      <Button size="sm" variant="ghost" onClick={onDiscard} disabled={pending}>
        Discard
      </Button>
      <Button
        type={submit ? "submit" : "button"}
        size="sm"
        disabled={!canSave || pending}
        onClick={onSave}
      >
        {pending ? "Saving…" : "Save changes"}
      </Button>
    </div>
  );
}

function DetailsSection({
  space,
  canEdit,
}: {
  space: Space;
  canEdit: boolean;
}) {
  const { organization } = useWorkspace();
  const router = useRouter();
  const { run, error, pending } = useConfirmed();
  const ids = { name: useId(), slug: useId(), description: useId() };
  const [name, setName] = useState(space.name);
  const [slug, setSlug] = useState(space.slug);
  const [description, setDescription] = useState(space.description ?? "");
  const [icon, setIcon] = useState(space.icon);
  const changed =
    name.trim() !== space.name ||
    slug !== space.slug ||
    description.trim() !== (space.description ?? "") ||
    icon !== space.icon;
  const valid = name.trim().length > 0 && slugPattern.test(slug);
  const save = async () => {
    if (!changed || !valid) return;
    const ok = await run({
      type: "updateSpace",
      spaceId: space.id,
      ...(name.trim() !== space.name ? { name: name.trim() } : {}),
      ...(slug !== space.slug ? { slug } : {}),
      ...(description.trim() !== (space.description ?? "")
        ? { description: description.trim() || null }
        : {}),
      ...(icon !== space.icon ? { icon } : {}),
    });
    if (ok && slug !== space.slug)
      router.replace(paths.spaceSettings(organization.slug, slug));
  };
  return (
    <SettingsSection
      id="details"
      icon={<FileText />}
      title="Details"
      description="How the space is named and found."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <SettingsBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor={ids.name}>
              <Input
                id={ids.name}
                value={name}
                maxLength={120}
                disabled={!canEdit}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Handle"
              htmlFor={ids.slug}
              hint={
                slugPattern.test(slug)
                  ? `/${organization.slug}/spaces/${slug}`
                  : "Use lowercase letters, digits and single hyphens."
              }
            >
              <Input
                id={ids.slug}
                value={slug}
                maxLength={60}
                disabled={!canEdit}
                aria-invalid={!slugPattern.test(slug)}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
              />
            </Field>
          </div>
          <IconField value={icon} onChange={setIcon} disabled={!canEdit} />
          <Field label="Description" htmlFor={ids.description} optional>
            <textarea
              id={ids.description}
              value={description}
              maxLength={2000}
              rows={3}
              disabled={!canEdit}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full resize-y rounded-xl border border-input bg-card px-3.5 py-2 text-[13px] shadow-xs outline-none focus:border-primary/60 focus:ring-3 focus:ring-primary/10 disabled:opacity-60 touch:text-base"
            />
          </Field>
          <InlineError>{error}</InlineError>
        </SettingsBody>
        {canEdit && changed && (
          <SaveBar
            submit
            pending={pending}
            canSave={valid}
            onDiscard={() => {
              setName(space.name);
              setSlug(space.slug);
              setDescription(space.description ?? "");
              setIcon(space.icon);
            }}
          />
        )}
      </form>
    </SettingsSection>
  );
}

function HomeSection({ space, canEdit }: { space: Space; canEdit: boolean }) {
  const { run, error, pending } = useConfirmed();
  const publishing = useConfirmed();
  const [home, setHome] = useState<HomeChoice>(() =>
    homeChoice(space.projectId, space.teamId),
  );
  const changed =
    home.projectId !== space.projectId || home.teamId !== space.teamId;
  return (
    <SettingsSection
      id="home"
      icon={<Home />}
      title="Home & publishing"
      description="Where the space appears in navigation, and how changes reach its published pages."
    >
      <SettingsBody className="space-y-5">
        <HomeFields
          value={home}
          onChange={setHome}
          disabled={!canEdit}
          hint="Changing the home changes who can edit while access is Inherited."
        />
        <InlineError>{error}</InlineError>
        <SegmentedChoice<SpacePublishing>
          label="Publishing"
          name="space-publishing-setting"
          value={space.publishing}
          disabled={!canEdit || publishing.pending}
          onChange={(next) =>
            void publishing.run({
              type: "updateSpace",
              spaceId: space.id,
              publishing: next,
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
      </SettingsBody>
      {canEdit && changed && (
        <SaveBar
          pending={pending}
          canSave
          onDiscard={() => setHome(homeChoice(space.projectId, space.teamId))}
          onSave={() =>
            void run({
              type: "updateSpace",
              spaceId: space.id,
              home: home.projectId
                ? home.teamId
                  ? { projectId: home.projectId, teamId: home.teamId }
                  : { projectId: home.projectId }
                : {},
            })
          }
        />
      )}
    </SettingsSection>
  );
}

function AccessSection({ space, canEdit }: { space: Space; canEdit: boolean }) {
  const { organization, directory, userId, isAdmin } = useWorkspace();
  const grants = useSpaceGrants(space.id);
  const mode = useConfirmed();
  const grant = useConfirmed();
  const [confirmRestrict, setConfirmRestrict] = useState(false);
  const home = homeOf(space, directory, organization.name);
  const people = grants
    .map((g) => ({
      grant: g,
      member: directory.members.find((m) => m.id === g.userId),
    }))
    .sort((a, b) => (a.member?.name ?? "").localeCompare(b.member?.name ?? ""));
  const setGrant = (memberId: string, level: SpaceAccessLevel | null) =>
    void grant.run({
      type: "setSpaceGrant",
      spaceId: space.id,
      userId: memberId,
      level,
    });
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
    <SettingsSection
      id="access"
      icon={<KeyRound />}
      title="Access"
      description={
        space.accessMode === "inherited"
          ? `Who can open and edit the space: its home’s people (${home.label}), and anyone named below.`
          : "Only the people named below can open this space; membership of its home grants nothing."
      }
      action={
        canEdit ? (
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
              onSelect={(id) => setGrant(id, "view")}
            />
          </Popover>
        ) : undefined
      }
      footer={
        isAdmin || canEdit
          ? "Administrators manage access without reading a restricted space. Adding yourself is how an administrator reads one, and every grant you give yourself is recorded in the audit log."
          : undefined
      }
    >
      <SettingsBody className="space-y-3 border-b">
        <SegmentedChoice<SpaceAccessMode>
          label="Access mode"
          name="space-access-setting"
          value={space.accessMode}
          disabled={!canEdit || mode.pending}
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
                "Only people with named access. Switching back keeps them.",
            },
          ]}
        />
        <InlineError>{mode.error}</InlineError>
      </SettingsBody>
      <SettingsList
        isEmpty={people.length === 0}
        empty={
          space.accessMode === "restricted"
            ? "Nobody has named access yet."
            : "No named access. Everyone gets access from the home."
        }
      >
        {people.map(({ grant: g, member }) => {
          const name = member?.name ?? "Former member";
          return (
            <div
              key={g.id}
              className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-2.5 text-[13px]"
            >
              <Avatar image={member?.image} name={name} size="md" />
              <div className="min-w-0 flex-1 basis-40">
                <span className="truncate font-medium">
                  {name}
                  {g.userId === userId && (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      (you)
                    </span>
                  )}
                </span>
                {member?.email && (
                  <div className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </div>
                )}
              </div>
              {g.userId === userId && g.grantedById === userId && (
                <Badge tone="info">Self-granted · audited</Badge>
              )}
              <DropdownSelect
                size="sm"
                className="w-32"
                aria-label={`Access of ${name}`}
                disabled={!canEdit || grant.pending}
                value={g.level}
                onValueChange={(value) =>
                  setGrant(g.userId, value as SpaceAccessLevel)
                }
              >
                {(["view", "comment", "edit"] as const).map((level) => (
                  <DropdownSelectOption key={level} value={level}>
                    {levelLabels[level]}
                  </DropdownSelectOption>
                ))}
              </DropdownSelect>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove ${name}’s access`}
                  disabled={grant.pending}
                  onClick={() => setGrant(g.userId, null)}
                >
                  Remove
                </Button>
              )}
            </div>
          );
        })}
      </SettingsList>
      {grant.error && (
        <div className="border-t px-5 py-3">
          <InlineError>{grant.error}</InlineError>
        </div>
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
    </SettingsSection>
  );
}

function ArchiveSection({
  space,
  canEdit,
}: {
  space: Space;
  canEdit: boolean;
}) {
  const { run, error, pending } = useConfirmed();
  const archived = Boolean(space.archivedAt);
  return (
    <SettingsSection
      id="archive"
      icon={<Archive />}
      title={archived ? "Archived" : "Archive"}
      description={
        archived
          ? "This space is hidden from navigation and its pages cannot change. Restoring it brings everything back."
          : "Hide the space from navigation and freeze its pages. Nothing is deleted, and administrators can restore it."
      }
      action={
        canEdit ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              void run({
                type: "archiveSpace",
                spaceId: space.id,
                archived: !archived,
              })
            }
          >
            {archived ? "Restore space" : "Archive space"}
          </Button>
        ) : undefined
      }
    >
      {error ? (
        <SettingsBody>
          <InlineError>{error}</InlineError>
        </SettingsBody>
      ) : null}
    </SettingsSection>
  );
}
