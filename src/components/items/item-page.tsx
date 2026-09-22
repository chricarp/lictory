"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "~/components/ui/primitives";
import { paths } from "~/lib/paths";
import { identifier, parseIdentifier } from "~/lib/work-items";
import { useWorkspace } from "~/components/workspace/provider";
import { useProject } from "~/components/workspace/project-gate";
import { useShell } from "~/components/workspace/shell";
import { ItemDetail } from "./item-detail";

// Accepts a human identifier (PAY-12) or an item UUID (used right after
// creation, before the server confirms the number) and normalizes the URL.
export function ItemPage({ identifier: raw }: { identifier: string }) {
  const { items, view, organization, projects } = useWorkspace();
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
          otherItem.kind === "epic" ? "epics" : "stories",
          identifier(otherProject, otherItem.number),
        ),
      );
  }, [otherProject, otherItem, router, organization.slug]);
  useEffect(() => {
    if (item && !parsed && !pendingCreate)
      router.replace(
        paths.item(
          organization.slug,
          project.key,
          item.kind === "epic" ? "epics" : "stories",
          identifier(project, item.number),
        ),
      );
  }, [item, parsed, pendingCreate, router, organization.slug, project]);
  if (!item) {
    if (view.status === "hydrating" || view.status === "syncing")
      return (
        <div className="p-8 text-sm text-muted-foreground" role="status">
          Opening {raw}…
        </div>
      );
    return (
      <EmptyState
        title={`${raw} was not found in ${project.name}`}
        action={
          <Link
            href={paths.list(organization.slug, project.key, "epics")}
            className="text-sm text-primary hover:underline"
          >
            Back to Epics
          </Link>
        }
      >
        It may belong to another project, or the identifier is misspelled.
      </EmptyState>
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
