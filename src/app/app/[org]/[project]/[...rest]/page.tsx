"use client";

import Link from "next/link";
import { Search } from "lucide-react";

import { Button } from "~/components/ui/button";
import { MissingState } from "~/components/ui/status-page";
import { paths } from "~/lib/paths";
import { useProject } from "~/components/workspace/project-gate";
import { useWorkspace } from "~/components/workspace/provider";

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
