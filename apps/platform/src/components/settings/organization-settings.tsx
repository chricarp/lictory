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

const sections = [
  { id: "general", label: "General", group: "Organization" },
  { id: "members", label: "Members", group: "Organization" },
  { id: "projects", label: "Projects", group: "Organization" },
  { id: "security", label: "Security", group: "Organization" },
  { id: "audit", label: "Audit log", group: "Organization" },
  { id: "export", label: "Data export", group: "Organization" },
  { id: "delete", label: "Delete organization", group: "Organization" },
  { id: "types", label: "Work item types", group: "Shared" },
  { id: "integrations", label: "Integrations", group: "Shared" },
  { id: "code", label: "Code hosts", group: "Shared" },
  { id: "intelligence", label: "Lictory Intelligence", group: "Shared" },
] as const;
type Section = (typeof sections)[number]["id"];

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
  const nav: SettingsNavItem[] = sections.map((s) => ({
    ...s,
    href: paths.settings(organization.slug, s.id),
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
        The credentials Lictory uses to reach Jira and Slack. Projects choose
        their Jira project in their delivery settings; channels link to Slack
        from their menu.
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
