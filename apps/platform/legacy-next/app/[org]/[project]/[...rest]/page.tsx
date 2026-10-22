"use client";

import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "@lictory/ui/button";
import { MissingState } from "@lictory/ui/status-page";
import { paths } from "@lictory/core/lib/paths";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

export default function UnknownProjectRoute() {
  const project = useProject();
  const { organization } = useWorkspace();
  return (
    <MissingState
      illustration="search"
      icon={Search}
      title="This page does not exist"
      action={
        <Link
          href={paths.list(organization.slug, project.key, "epics")}
          className="contents"
        >
          <Button variant="secondary">Back to Epics</Button>
        </Link>
      }
    >
      {project.name} has no page at this address.
    </MissingState>
  );
}
