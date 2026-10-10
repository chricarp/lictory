import { ProjectSettings } from "~/components/settings/project-settings";

export default async function ProjectSettingsPage({
  params,
}: PageProps<"/app/[org]/[project]/settings/[[...section]]">) {
  const { section } = await params;
  return <ProjectSettings section={section?.[0] ?? "general"} />;
}
