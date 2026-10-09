"use client";
import { useWorkspace } from "~/components/workspace/provider";
import { OrganizationMark } from "~/components/workspace/organization-logo";
import { People } from "~/components/workspace/roles-settings";
import {
  ReadOnlyNotice,
  SettingsLayout,
  type SettingsNavItem,
} from "~/components/workspace/settings-section";
import { JiraConnections } from "~/components/delivery/delivery-settings";
import { paths } from "~/lib/paths";
import { OrganizationGeneral } from "./org-general";
import { OrganizationProjects } from "./org-projects";
import { OrganizationTypes } from "./org-types";
import { OrganizationIntelligence } from "./org-intelligence";

const sections = [
  { id: "general", label: "General", group: "Organization" },
  { id: "members", label: "Members", group: "Organization" },
  { id: "projects", label: "Projects", group: "Organization" },
  { id: "types", label: "Work item types", group: "Shared" },
  { id: "integrations", label: "Integrations", group: "Shared" },
  { id: "intelligence", label: "Lictory Intelligence", group: "Shared" },
] as const;
type Section = (typeof sections)[number]["id"];

// Organization settings own what every project shares: identity, people and
// application roles, the project list, the type registry, Jira credentials
// and whether Lictory Intelligence may run. Everything about how a project
// works lives in its own settings.
export function OrganizationSettings({ section }: { section: string }) {
  const { organization, directory, isAdmin } = useWorkspace();
  const active: Section =
    sections.find((s) => s.id === section)?.id ?? "general";
  const nav: SettingsNavItem[] = sections.map((s) => ({
    ...s,
    href: paths.settings(organization.slug, s.id),
  }));
  return (
    <SettingsLayout
      icon={
        organization.logos.mark ? (
          <OrganizationMark
            organization={organization}
            className="size-10 rounded-xl"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-semibold text-primary"
          >
            {organization.name.slice(0, 1).toUpperCase()}
          </span>
        )
      }
      title="Organization settings"
      subtitle={
        <>
          {organization.name} · {directory.members.length}{" "}
          {directory.members.length === 1 ? "member" : "members"}
          {!isAdmin && " · only administrators can change these settings"}
        </>
      }
      nav={nav}
      active={active}
    >
      {active === "general" && <OrganizationGeneral />}
      {active === "members" && <People />}
      {active === "projects" && <OrganizationProjects />}
      {active === "types" && <OrganizationTypes />}
      {active === "integrations" && <Integrations />}
      {active === "intelligence" && <OrganizationIntelligence />}
    </SettingsLayout>
  );
}

function Integrations() {
  const { isAdmin } = useWorkspace();
  return (
    <>
      <p className="px-1 text-[13px] leading-5 text-muted-foreground">
        Connections hold the credentials Lictory uses to reach Jira. Each
        project delivered in Jira picks its Jira project and maps its work item
        types in its own delivery settings.
      </p>
      <JiraConnections />
      {!isAdmin && (
        <ReadOnlyNotice>
          Only organization administrators connect and update Jira.
        </ReadOnlyNotice>
      )}
    </>
  );
}
