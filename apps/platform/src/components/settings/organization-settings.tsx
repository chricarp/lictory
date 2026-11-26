import type { ReactNode } from "react";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { People } from "@lictory/platform/components/workspace/roles-settings";
import {
  ReadOnlyNotice,
  SettingsLayout,
  type SettingsNavItem,
} from "@lictory/platform/components/workspace/settings-section";
import { JiraConnections } from "@lictory/platform/components/delivery/delivery-settings";
import { CodeHostSettings } from "@lictory/platform/components/code/code-settings";
import { paths } from "@lictory/core/lib/paths";
import { OrganizationGeneral } from "@lictory/platform/components/settings/org-general";
import { OrganizationProjects } from "@lictory/platform/components/settings/org-projects";
import { OrganizationSecurity } from "@lictory/platform/components/settings/org-security";
import { OrganizationWebhookPolicy } from "@lictory/platform/components/settings/org-webhook-policy";
import { OrganizationTypes } from "@lictory/platform/components/settings/org-types";
import { OrganizationIntelligence } from "@lictory/platform/components/settings/org-intelligence";
import { OrganizationAudit } from "@lictory/platform/components/settings/org-audit";
import { OrganizationExport } from "@lictory/platform/components/settings/org-export";
import { OrganizationDeletion } from "@lictory/platform/components/settings/org-deletion";
import { SlackConnection } from "@lictory/platform/components/settings/org-slack";
import {
  organizationSettingsSections,
  type OrganizationSettingsSectionId,
} from "@lictory/platform/components/settings/organization-sections";

const sections = organizationSettingsSections;
type Section = OrganizationSettingsSectionId;

// Organization settings own what every project shares: identity, people and
// application roles, the project list, the type registry, Jira credentials
// and whether Lictory Intelligence may run. Everything about how a project
// works lives in its own settings.
export function OrganizationSettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { organization, directory, isAdmin } = useWorkspace();
  const nav: SettingsNavItem[] = sections.map(({ id, label, group }) => ({
    id,
    label,
    group,
    href: paths.settings(organization.slug, id),
  }));
  return (
    <SettingsLayout
      title="Organization settings"
      subtitle={
        <>
          {organization.name} · {directory.members.length}{" "}
          {directory.members.length === 1 ? "member" : "members"}
          {!isAdmin && " · only administrators can change these settings"}
        </>
      }
      nav={nav}
    >
      {children}
    </SettingsLayout>
  );
}

export function OrganizationSettingsSection({ section }: { section: string }) {
  const { isAdmin } = useWorkspace();
  const active: Section =
    sections.find((s) => s.id === section)?.id ?? "general";
  return (
    <>
      {active === "general" && <OrganizationGeneral />}
      {active === "members" && <People />}
      {active === "projects" && <OrganizationProjects />}
      {active === "security" && (
        <>
          <OrganizationSecurity />
          {isAdmin && <OrganizationWebhookPolicy />}
        </>
      )}
      {active === "audit" && <OrganizationAudit />}
      {active === "export" && <OrganizationExport />}
      {active === "delete" && <OrganizationDeletion />}
      {active === "types" && <OrganizationTypes />}
      {active === "integrations" && <Integrations />}
      {active === "code" && <CodeHostSettings />}
      {active === "intelligence" && <OrganizationIntelligence />}
    </>
  );
}

function Integrations() {
  const { isAdmin } = useWorkspace();
  return (
    <>
      <p className="px-1 text-[13px] leading-5 text-muted-foreground">
        Connections hold the credentials Lictory uses to reach Jira and Slack.
        Each project delivered in Jira picks its Jira project and maps its work
        item types in its own delivery settings; each channel links to Slack
        from its own menu.
      </p>
      <JiraConnections />
      <SlackConnection />
      {!isAdmin && (
        <ReadOnlyNotice>
          Only organization administrators connect and update Jira and Slack.
        </ReadOnlyNotice>
      )}
    </>
  );
}
