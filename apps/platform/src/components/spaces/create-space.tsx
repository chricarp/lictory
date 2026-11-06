import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type {
  SpaceAccessMode,
  SpacePublishing,
} from "@lictory/core/contracts/protocol";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { useRouter } from "@lictory/platform/lib/navigation";
import { slugPattern, suggestSlug } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  Dialog,
  Field,
  SegmentedChoice,
} from "@lictory/platform/components/spaces/dialog";
import {
  HomeFields,
  IconPicker,
  homeChoice,
  type HomeChoice,
} from "@lictory/platform/components/spaces/space-fields";
import {
  homeOf,
  inheritedAccess,
  publishingDescriptions,
} from "@lictory/platform/components/spaces/space-meta";
import type { CreateSpaceDefaults } from "@lictory/platform/components/spaces/store";

// Name first; everything else has a sensible default, summarized in one
// line ("Northwind · everyone can edit · direct publishing") that opens to
// change it. The space exists once
// the server confirms it (access is never predicted), then it opens.
export function CreateSpaceDialog({
  defaults,
  onClose,
}: {
  defaults: CreateSpaceDefaults;
  onClose: () => void;
}) {
  const { organization, directory, mutateConfirmed } = useWorkspace();
  const router = useRouter();
  const ids = {
    name: useId(),
    slug: useId(),
    description: useId(),
    access: useId(),
    accessBody: useId(),
  };
  const [showAccess, setShowAccess] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [home, setHome] = useState<HomeChoice>(() =>
    homeChoice(defaults.projectId ?? null, defaults.teamId ?? null),
  );
  const [accessMode, setAccessMode] = useState<SpaceAccessMode>("inherited");
  const [publishing, setPublishing] = useState<SpacePublishing>("direct");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const handle = slugEdited ? slug : suggestSlug(name);
  const homeInfo = homeOf(
    { projectId: home.projectId, teamId: home.teamId },
    directory,
    organization.name,
  );
  const summary = [
    homeInfo.label,
    accessMode === "restricted"
      ? "only people you add"
      : homeInfo.kind === "organization"
        ? "everyone can edit"
        : "members edit, everyone else views",
    publishing === "direct" ? "direct publishing" : "reviewed publishing",
  ].join(" · ");
  const homeIncomplete =
    (home.kind !== "organization" && !home.projectId) ||
    (home.kind === "team" && !home.teamId);
  const handleValid = slugPattern.test(handle);
  const ready = name.trim().length > 0 && handleValid && !homeIncomplete;
  const submit = async () => {
    if (!ready || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await mutateConfirmed({
        type: "createSpace",
        spaceId: crypto.randomUUID(),
        name: name.trim(),
        slug: handle,
        description: description.trim() || undefined,
        icon: icon ?? undefined,
        home:
          home.kind === "organization"
            ? {}
            : home.kind === "project"
              ? { projectId: home.projectId! }
              : { projectId: home.projectId!, teamId: home.teamId! },
        accessMode,
        publishing,
      });
      onClose();
      router.push(paths.space(organization.slug, handle));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The space was not created.");
      setPending(false);
    }
  };
  return (
    <Dialog
      title="New space"
      description="Pages your team writes and reviews together: handbooks, decisions, runbooks."
      onClose={onClose}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || pending}>
            {pending ? "Creating…" : "Create space"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor={ids.name} className="block text-xs font-medium">
            Name
          </label>
          <div className="flex items-center gap-2">
            <IconPicker value={icon} onChange={setIcon} />
            <Input
              id={ids.name}
              data-autofocus
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Payments handbook"
              autoComplete="off"
              className="border-foreground/15"
            />
          </div>
          {/* The handle follows the name until someone edits it. */}
          <details className="group text-xs text-muted-foreground">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
              <span className="truncate">
                /{organization.slug}/spaces/{handle || "…"}
              </span>
              <span className="font-medium text-foreground underline underline-offset-2 group-open:hidden">
                Change
              </span>
            </summary>
            <div className="mt-2">
              <Field
                label="Handle"
                htmlFor={ids.slug}
                hint={
                  handle && !handleValid
                    ? "Use lowercase letters, digits and single hyphens."
                    : "Part of the space’s address; links keep working only while it stays the same."
                }
              >
                <Input
                  id={ids.slug}
                  value={handle}
                  maxLength={60}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="payments-handbook"
                  autoComplete="off"
                  className="border-foreground/15"
                  aria-invalid={handle !== "" && !handleValid}
                />
              </Field>
            </div>
          </details>
        </div>
        <Field label="Description" htmlFor={ids.description} optional>
          <textarea
            id={ids.description}
            value={description}
            maxLength={2000}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What belongs in this space?"
            className="w-full resize-y rounded-xl border border-foreground/15 bg-card px-3.5 py-2 text-[13px] shadow-xs outline-none placeholder:text-muted-foreground focus:border-primary/60 focus:ring-3 focus:ring-primary/10 touch:text-base"
          />
        </Field>
        <section
          aria-labelledby={ids.access}
          className="overflow-hidden rounded-xl ring-1 ring-foreground/10 ring-inset"
        >
          <button
            type="button"
            aria-expanded={showAccess}
            aria-controls={ids.accessBody}
            onClick={() => setShowAccess((v) => !v)}
            className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
          >
            <span className="min-w-0 flex-1">
              <span
                id={ids.access}
                className="block text-xs font-medium text-foreground"
              >
                Access & publishing
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
                {summary}
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-foreground">
              {showAccess ? "Hide" : "Change"}
              <ChevronDown
                aria-hidden
                className={cn(
                  "size-3.5 text-muted-foreground motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out",
                  showAccess && "rotate-180",
                )}
              />
            </span>
          </button>
          <div
            id={ids.accessBody}
            hidden={!showAccess}
            className="space-y-4 border-t bg-muted/30 px-3.5 py-3.5"
          >
            <HomeFields
              value={home}
              onChange={setHome}
              hint="Where the space appears in navigation."
            />
            <SegmentedChoice
              label="Access"
              name="space-access"
              value={accessMode}
              onChange={setAccessMode}
              options={[
                {
                  value: "inherited",
                  label: "Inherited",
                  description: inheritedAccess(homeInfo, organization.name),
                },
                {
                  value: "restricted",
                  label: "Restricted",
                  description:
                    "Only people you add can open it. You get edit access.",
                },
              ]}
            />
            <SegmentedChoice
              label="Publishing"
              name="space-publishing"
              value={publishing}
              onChange={setPublishing}
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
          </div>
        </section>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
