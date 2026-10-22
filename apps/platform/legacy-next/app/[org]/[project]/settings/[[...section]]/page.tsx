import { ProjectSettingsSection } from "@lictory/platform/components/settings/project-settings";

export default async function ProjectSettingsPage({
  params,
}: PageProps<"/app/[org]/[project]/settings/[[...section]]">) {
  const { section } = await params;
  return <ProjectSettingsSection section={section?.[0] ?? "general"} />;
}
