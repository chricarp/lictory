import { OrganizationSettingsSection } from "~/components/settings/organization-settings";

export default async function SettingsPage({
  params,
}: PageProps<"/app/[org]/settings/[[...section]]">) {
  const { section } = await params;
  return <OrganizationSettingsSection section={section?.[0] ?? "general"} />;
}
