// Pages of the public documentation that the product links to where it keeps
// an explanation to one sentence ("Learn more"). Settings say what a control
// does; the documentation says how and why. The test checks that every page
// and heading anchor below exists in apps/docs.
const docsOrigin = "https://docs.lictory.com";

export const docsPages = {
  autonomy: "/factory/autonomy#autonomy-levels",
  branding: "/organization/security#name-handle-and-branding",
  codeHosts: "/integrations/code-hosts",
  codeHostWebhook: "/integrations/code-hosts#add-the-webhook",
  jira: "/integrations/jira",
  jiraTypes: "/integrations/jira#choose-the-jira-project-and-map-types",
  slack: "/integrations/slack",
  deliveryModes: "/concepts/delivery",
  shortcuts: "/basics/shortcuts",
} as const;

export type DocsPage = keyof typeof docsPages;

export function docsUrl(page: DocsPage) {
  return `${docsOrigin}${docsPages[page]}`;
}
