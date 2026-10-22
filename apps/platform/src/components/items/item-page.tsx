import { LoadingState } from "@lictory/ui/spinner";
import { useEffect } from "react";
import { Link } from "@lictory/platform/lib/navigation";
import { useRouter } from "@lictory/platform/lib/navigation";
import { FileSearch } from "lucide-react";
import { Button } from "@lictory/ui/button";
import { MissingState } from "@lictory/ui/status-page";
import { paths } from "@lictory/core/lib/paths";
import {
  identifier,
  parseIdentifier,
  segmentOf,
  typeOf,
} from "@lictory/core/lib/work-items";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import {
  SyncIssue,
  isSyncBlocked,
} from "@lictory/platform/components/workspace/sync-issue";
import { useShell } from "@lictory/platform/components/workspace/shell";
import { ItemDetail } from "@lictory/platform/components/items/item-detail";

// Accepts a human identifier (PAY-12) or an item UUID (used right after
// creation, before the server confirms the number) and normalizes the URL.
export function ItemPage({ identifier: raw }: { identifier: string }) {
  const { items, view, organization, projects, delivery } = useWorkspace();
  const project = useProject();
  const { setCurrentItem } = useShell();
  const router = useRouter();
  const parsed = parseIdentifier(raw);
  const item = items.find((i) =>
    parsed
      ? i.projectId === project.id &&
        parsed.key === project.key &&
        i.number === parsed.number
      : i.id === raw,
  );
  const pendingCreate = item
    ? view.pending.some(
        (q) =>
          q.mutation.command.type === "createWorkItem" &&
          q.mutation.command.workItemId === item.id,
      )
    : false;
  useEffect(() => {
    setCurrentItem(item);
    return () => setCurrentItem(undefined);
  }, [item, setCurrentItem]);
  // A key from another project: forward to that project's canonical route.
  const otherProject =
    parsed && parsed.key !== project.key
      ? projects.find((p) => p.key === parsed.key)
      : undefined;
  const otherItem = otherProject
    ? items.find(
        (i) => i.projectId === otherProject.id && i.number === parsed!.number,
      )
    : undefined;
  useEffect(() => {
    if (otherProject && otherItem)
      router.replace(
        paths.item(
          organization.slug,
          otherProject.key,
          segmentOf(typeOf(delivery, otherItem)),
          identifier(otherProject, otherItem.number),
        ),
      );
  }, [otherProject, otherItem, router, organization.slug, delivery]);
  useEffect(() => {
    if (item && !parsed && !pendingCreate)
      router.replace(
        paths.item(
          organization.slug,
          project.key,
          segmentOf(typeOf(delivery, item)),
          identifier(project, item.number),
        ),
      );
  }, [
    item,
    parsed,
    pendingCreate,
    router,
    organization.slug,
    project,
    delivery,
  ]);
  if (!item) {
    if (view.status === "hydrating")
      return <LoadingState label={`Opening ${raw}`} />;
    if (isSyncBlocked(view.status))
      return <SyncIssue status={view.status} error={view.error} />;
    return (
      <MissingState
        illustration="search"
        icon={FileSearch}
        title={`${raw} was not found in ${project.name}`}
        action={
          <Link
            href={paths.list(organization.slug, project.key, "epics")}
            className="contents"
          >
            <Button variant="secondary">Back to Epics</Button>
          </Link>
        }
      >
        It may belong to another project, or the identifier is misspelled.
      </MissingState>
    );
  }
  return (
    <ItemDetail
      key={item.id}
      item={item}
      project={project}
      pendingCreate={pendingCreate}
    />
  );
}
