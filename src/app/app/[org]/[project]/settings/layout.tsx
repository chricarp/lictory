import { ProjectSettingsLayout } from "~/components/settings/project-settings";

export default function SettingsLayout({
  children,
}: LayoutProps<"/app/[org]/[project]/settings">) {
  return <ProjectSettingsLayout>{children}</ProjectSettingsLayout>;
}
