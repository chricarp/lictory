import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Link, useRouter } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Lictory's sample project (docs/internals/onboarding.md#sample-project):
// offered from an empty first project, labelled wherever it is open.

type Created = { projectId: string; projectKey: string; workItemKey: string };

const errorText = (error: unknown) =>
  error instanceof Error && error.message
    ? error.message
    : "The sample project was not created. Try again.";

// The offer in an empty project's next steps (administrators only). Once a
// sample exists it links to it instead; an archived sample is not offered
// again.
export function SampleProjectOffer({ project }: { project: Project }) {
  const { organization, projects, items, directory } = useWorkspace();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [created, setCreated] = useState<Created>();
  const existing = directory.projects.find((p) => p.sample);
  const synced =
    created &&
    projects.some((p) => p.id === created.projectId) &&
    items.some((i) => i.projectId === created.projectId);
  // The sample arrives through synchronization; open it once it has.
  useEffect(() => {
    if (created && synced)
      router.push(
        paths.item(organization.slug, created.projectKey, created.workItemKey),
      );
  }, [created, synced, router, organization.slug]);

  if (existing?.archivedAt || existing?.id === project.id) return null;
  if (existing)
    return (
      <Link
        href={paths.proposals(organization.slug, existing.key)}
        className="mt-3 block text-primary hover:underline"
      >
        Open the sample project →
      </Link>
    );
  const create = async () => {
    setPending(true);
    setError(undefined);
    try {
      setCreated(
        await callCapability<Created>("createSampleProject", {
          organizationId: organization.id,
          fromProjectId: project.id,
        }),
      );
    } catch (e) {
      setError(errorText(e));
      setPending(false);
    }
  };
  return (
    <span className="mt-4 block border-t pt-4">
      <span className="block font-medium text-foreground">
        Exploring on your own?
      </span>
      <span className="mt-1 block">
        A sample project shows a specification in review: revisions, a blocking
        discussion, a recorded decision, a pull request and the readiness
        checks. You are its only author, and nothing in it is approved.
      </span>
      <Button
        className="mt-3"
        size="sm"
        variant="secondary"
        onClick={() => void create()}
        disabled={pending}
      >
        <FlaskConical className="size-3.5" />
        {pending ? "Creating the sample…" : "Explore a sample project"}
      </Button>
      {error && (
        <span role="alert" className="mt-2 block text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}

// A strip above every page of the sample project, so its content is never
// mistaken for real work, with the way out.
export function SampleProjectBanner({ project }: { project: Project }) {
  const { organization, isAdmin, projects } = useWorkspace();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const archive = async () => {
    setPending(true);
    setError(undefined);
    try {
      await callCapability("archiveSampleProject", {
        organizationId: organization.id,
      });
      const next = projects.find((p) => !p.archivedAt && !p.sample);
      router.push(
        next
          ? paths.proposals(organization.slug, next.key)
          : paths.inbox(organization.slug),
      );
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message
          : "The sample project was not archived. Try again.",
      );
      setPending(false);
    }
  };
  return (
    <div
      role="note"
      aria-label="Sample project"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground"
    >
      <FlaskConical className="size-3.5 shrink-0 text-foreground" />
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">Sample project.</span> You
        created everything here to explore the review workflow. Open{" "}
        <Link
          href={paths.item(organization.slug, project.key, `${project.key}-1`)}
          className="text-primary hover:underline"
        >
          {project.key}-1
        </Link>
        , resolve its blocking discussion and watch its readiness checks.
      </span>
      {error && (
        <span role="alert" className="text-destructive">
          {error}
        </span>
      )}
      {isAdmin && !project.archivedAt && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void archive()}
          disabled={pending}
          title="Archives the sample project and its handbook. Restore them in Settings → Projects."
        >
          {pending ? "Archiving…" : "Archive sample"}
        </Button>
      )}
    </div>
  );
}
