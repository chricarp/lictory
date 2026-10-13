import type { LegalSection } from "~/components/legal/legal-document";

/** Cloud contracts describe one operator, never every installation of the code. */
export function deploymentLegalSections(
  cloudSections: LegalSection[],
  template: string | undefined,
): LegalSection[] {
  if (template === "cloud") return cloudSections;
  return [
    {
      id: "operator-notice",
      title: "This deployment’s legal notices",
      body: "This is a self-hosted Lictory installation. Its operator must supply terms and a privacy notice describing this deployment before inviting users. The official Lictory Cloud agreements do not apply automatically to this installation. Contact the operator identified above for the applicable notices and privacy requests. This page is a draft even when contact details are complete.",
    },
    {
      id: "software-and-service",
      title: "Software and service",
      body: "The software license governs use and distribution of the source code. It does not establish a hosting agreement, a data-processing agreement, a support commitment or permission to send workspace data to external providers. Your installation’s operator is responsible for its infrastructure, integrations, retention and notices.",
    },
  ];
}
