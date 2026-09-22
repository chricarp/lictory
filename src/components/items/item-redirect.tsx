"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { FileSearch } from "lucide-react";
import { Button } from "~/components/ui/button";
import { MissingState } from "~/components/ui/status-page";
import { paths } from "~/lib/paths";
import { identifier, parseIdentifier } from "~/lib/work-items";
import { useWorkspace } from "~/components/workspace/provider";
import { SyncIssue, isSyncBlocked } from "~/components/workspace/sync-issue";

export function ItemRedirect({ identifier: raw }: { identifier: string }) {
  const { items, projects, organization, view } = useWorkspace();
  const router = useRouter();
  const parsed = parseIdentifier(raw);
  const project = parsed
    ? projects.find((p) => p.key === parsed.key)
    : undefined;
  const item = parsed
    ? items.find(
        (i) => i.projectId === project?.id && i.number === parsed.number,
      )
    : items.find((i) => i.id === raw);
  const target = item
    ? paths.item(
        organization.slug,
        projects.find((p) => p.id === item.projectId)?.key ?? "",
        item.kind === "epic" ? "epics" : "stories",
        identifier(
          projects.find((p) => p.id === item.projectId),
          item.number,
        ),
      )
    : undefined;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  if (target || view.status === "hydrating" || view.status === "syncing")
    return (
      <div className="p-8 text-sm text-muted-foreground" role="status">
        Opening {raw}…
      </div>
    );
  if (isSyncBlocked(view.status))
    return <SyncIssue status={view.status} error={view.error} />;
  return (
    <MissingState
      icon={FileSearch}
      title={`${raw} was not found`}
      action={
        <Link href={paths.inbox(organization.slug)} className="contents">
          <Button variant="secondary">Go to Inbox</Button>
        </Link>
      }
    >
      {parsed && !project
        ? `No project uses the key ${parsed.key}.`
        : "Check the identifier and try again."}
    </MissingState>
  );
}
