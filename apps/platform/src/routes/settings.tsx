import { Outlet } from "@tanstack/react-router";
import {
  OrganizationSettingsLayout,
  OrganizationSettingsSection,
} from "@lictory/platform/components/settings/organization-settings";
import {
  ProjectSettingsLayout,
  ProjectSettingsSection,
} from "@lictory/platform/components/settings/project-settings";
import { useParams } from "@lictory/platform/lib/navigation";

export function OrganizationSettingsRoute() {
  return (
    <OrganizationSettingsLayout>
      <Outlet />
    </OrganizationSettingsLayout>
  );
}

export function OrganizationSettingsPage() {
  const { section } = useParams<{ section: string }>();
  return <OrganizationSettingsSection section={section ?? "general"} />;
}

export function ProjectSettingsRoute() {
  return (
    <ProjectSettingsLayout>
      <Outlet />
    </ProjectSettingsLayout>
  );
}

export function ProjectSettingsPage() {
  const { section } = useParams<{ section: string }>();
  return <ProjectSettingsSection section={section ?? "general"} />;
}
