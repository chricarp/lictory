import type { ReactNode } from "react";
import { Send } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import type { Project } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { MissingState } from "@lictory/ui/status-page";
import { Link } from "@lictory/platform/lib/navigation";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { projectDeliveryTool } from "@lictory/platform/components/delivery/provider-name";

// External projects deliver in another tool: Lictory shows the hand-off instead of a
// board, backlog, iterations or factory queue. The page keeps its header, so
// people still know where they are.
export function ExternalProjectNotice({
  project,
  title,
  icon,
  children,
}: {
  project: Project;
  title: string;
  icon: ReactNode;
  children?: ReactNode;
}) {
  const { organization, directory } = useWorkspace();
  const tool = projectDeliveryTool(directory, project.id);
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={title}
        icon={icon}
        breadcrumbs={[
          {
            label: project.name,
            href: paths.project(organization.slug, project.key),
          },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MissingState
          headingLevel={2}
          illustration="planning"
          icon={Send}
          title={`${project.name} delivers in ${tool.name}`}
          action={
            <Button
              variant="secondary"
              render={
                <Link href={paths.handoff(organization.slug, project.key)} />
              }
            >
              Open hand-off
            </Button>
          }
        >
          {children ?? (
            <>Statuses, sprints and estimates live in {tool.name}.</>
          )}
        </MissingState>
      </div>
    </div>
  );
}
