import { OrganizationSettingsLayout } from "@lictory/platform/components/settings/organization-settings";

export default function SettingsLayout({
  children,
}: LayoutProps<"/app/[org]/settings">) {
  return <OrganizationSettingsLayout>{children}</OrganizationSettingsLayout>;
}
