import { OrganizationSettingsLayout } from "~/components/settings/organization-settings";

export default function SettingsLayout({
  children,
}: LayoutProps<"/app/[org]/settings">) {
  return <OrganizationSettingsLayout>{children}</OrganizationSettingsLayout>;
}
