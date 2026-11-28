// The sections of organization settings, in their navigation order. Shared
// by the settings layout and the command palette, which offers each one as a
// destination ("Audit log", "Code hosts") with the words people search for.
export const organizationSettingsSections = [
  {
    id: "general",
    label: "General",
    group: "Organization",
    keywords: "name handle logo organization",
  },
  {
    id: "members",
    label: "Members",
    group: "Organization",
    keywords: "people invite invitations roles administrators",
  },
  {
    id: "projects",
    label: "Projects",
    group: "Organization",
    keywords: "create archive project list",
  },
  {
    id: "security",
    label: "Security",
    group: "Organization",
    keywords: "two-factor 2fa sso single sign-on webhooks agent events",
  },
  {
    id: "audit",
    label: "Audit log",
    group: "Organization",
    keywords: "audit history who changed export csv compliance",
  },
  {
    id: "export",
    label: "Data export",
    group: "Organization",
    keywords: "export download backup archive",
  },
  {
    id: "delete",
    label: "Delete organization",
    group: "Organization",
    keywords: "delete remove organization",
  },
  {
    id: "types",
    label: "Work item types",
    group: "Shared",
    keywords: "types epic story task bug subtask",
  },
  {
    id: "integrations",
    label: "Integrations",
    group: "Shared",
    keywords: "jira slack integrations connect",
  },
  {
    id: "code",
    label: "Code hosts",
    group: "Shared",
    keywords: "github gitlab bitbucket repositories webhook token",
  },
  {
    id: "intelligence",
    label: "Lictory Intelligence",
    group: "Shared",
    keywords: "ai model provider litto intelligence",
  },
] as const;
export type OrganizationSettingsSectionId =
  (typeof organizationSettingsSections)[number]["id"];
