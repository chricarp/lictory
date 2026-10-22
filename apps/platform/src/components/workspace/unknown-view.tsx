import { Link } from "@lictory/platform/lib/navigation";
import { Search } from "lucide-react";

import { Button } from "@lictory/ui/button";
import { MissingState } from "@lictory/ui/status-page";
import { paths } from "@lictory/core/lib/paths";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

export function UnknownView() {
  const project = useProject();
  const { organization } = useWorkspace();
  return (
    <MissingState
      illustration="search"
      icon={Search}
      title="This view was not found"
      action={
        <Link
          href={paths.list(organization.slug, project.key, "epics")}
          className="contents"
        >
          <Button variant="secondary">Back to Epics</Button>
        </Link>
      }
    >
      {project.name} has no saved view at this address.
    </MissingState>
  );
}
