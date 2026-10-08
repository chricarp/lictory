"use client";

import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "~/components/ui/button";
import { MissingState } from "~/components/ui/status-page";
import { paths } from "~/lib/paths";
import { useProject } from "./project-gate";
import { useWorkspace } from "./provider";

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
