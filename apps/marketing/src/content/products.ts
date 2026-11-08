// Public facts about Lictory and the products it is compared with: licensing,
// hosting and pricing model. Comparison, alternatives and roundup pages all
// read them from here, so one product is described the same way everywhere.
//
// Only state what the vendor's own public website, documentation or source
// repository says, and link it in `sources`. When something cannot be checked
// there, leave it out rather than guess. Update `reviewed` whenever the facts
// are checked again, even when nothing changed.

export type ProductId =
  | "lictory"
  | "jira"
  | "plane"
  | "openproject"
  | "taiga"
  | "jama"
  | "doors"
  | "polarion"
  | "modern-requirements"
  | "reqview"
  | "confluence"
  | "doorstop"
  | "strictdoc";

export type ProductProfile = {
  id: ProductId;
  name: string;
  /** The product's own website. */
  website: string;
  /** License of the edition anyone can run, or "Proprietary". */
  license: string;
  /** The license in a word or two, for overview tables. */
  licenseShort: string;
  /** Where it runs: vendor cloud, your own servers, or both. */
  hosting: string;
  /** The hosting options in a few words, for overview tables. */
  hostingShort: string;
  /** How it is charged for, without prices that change often. */
  pricing: string;
  /** How it is installed on your own servers, in a few words. */
  selfHosting?: string;
  /** Whether and how it imports existing Jira projects, in a few words. */
  jiraImport?: string;
  /** Pages the facts above were checked against. */
  sources: ReadonlyArray<{ label: string; url: string }>;
  /** ISO date the facts were last checked against the sources. */
  reviewed: string;
};

export const products: Record<ProductId, ProductProfile> = {
  lictory: {
    id: "lictory",
    name: "Lictory",
    website: "https://lictory.com",
    license:
      "MIT. Every feature is in the open-source code; there is no paid edition.",
    licenseShort: "MIT",
    hosting:
      "Self-hosted only: one Linux server with Docker Compose and PostgreSQL (bundled or your own). There is no Lictory cloud.",
    hostingShort: "Self-hosted",
    pricing: "Free. You pay only for the server you run it on.",
    selfHosting: "Docker Compose on one Linux server",
    jiraImport: "No importer yet",
    sources: [
      {
        label: "Source code and license",
        url: "https://github.com/chricarp/lictory",
      },
      {
        label: "Self-hosting requirements",
        url: "https://docs.lictory.com/self-hosting",
      },
    ],
    reviewed: "2026-11-08",
  },
  jira: {
    id: "jira",
    name: "Jira",
    website: "https://www.atlassian.com/software/jira",
    license:
      "Commercial, under the Atlassian Customer Agreement. Not open source.",
    licenseShort: "Commercial",
    hosting:
      "Jira Cloud. Self-managed Jira Data Center is no longer sold to new customers (since 30 March 2026) and reaches end of life on 28 March 2029; Jira Server support ended on 15 February 2024.",
    hostingShort: "Cloud; Data Center ends 2029",
    pricing:
      "Cloud: free for up to 10 users; Standard, Premium and Enterprise are priced per user, monthly or annually. Data Center: annual subscriptions by user tier.",
    selfHosting: "Data Center, until 28 March 2029",
    sources: [
      {
        label: "Pricing",
        url: "https://www.atlassian.com/software/jira/pricing",
      },
      {
        label: "Data Center end of life announcement",
        url: "https://www.atlassian.com/blog/announcements/atlassian-ascend",
      },
      {
        label: "Data Center licensing",
        url: "https://www.atlassian.com/licensing/data-center",
      },
      {
        label: "Server end of support",
        url: "https://www.atlassian.com/licensing/server-end-of-support",
      },
      {
        label: "Customer Agreement",
        url: "https://www.atlassian.com/legal/atlassian-customer-agreement",
      },
    ],
    reviewed: "2026-11-08",
  },
  plane: {
    id: "plane",
    name: "Plane",
    website: "https://plane.so",
    license:
      "AGPL-3.0 for the Community Edition. A separate Commercial Edition adds features such as workflows, approvals, SSO and audit trails.",
    licenseShort: "AGPL-3.0, plus paid editions",
    hosting:
      "Plane Cloud, or self-hosted with Docker Compose, Kubernetes (Helm), Podman or one-click platforms; air-gapped deployments are offered.",
    hostingShort: "Cloud or self-hosted",
    selfHosting: "Docker Compose, Kubernetes, Podman",
    jiraImport: "Cloud and Commercial Edition only",
    pricing:
      "The Community Edition is free to self-host with no user limit. Plane Cloud has a free plan for up to 12 users; Pro and Business are priced per user per month, Enterprise Grid on request.",
    sources: [
      { label: "Open source editions", url: "https://plane.so/open-source" },
      { label: "Pricing", url: "https://plane.so/pricing" },
      {
        label: "License",
        url: "https://github.com/makeplane/plane/blob/preview/LICENSE.txt",
      },
      {
        label: "Self-hosting",
        url: "https://developers.plane.so/self-hosting/overview",
      },
      {
        label: "Workflows and approvals",
        url: "https://docs.plane.so/workflows-and-approvals/workflows",
      },
      { label: "Jira importer", url: "https://docs.plane.so/importers/jira" },
    ],
    reviewed: "2026-11-08",
  },
  openproject: {
    id: "openproject",
    name: "OpenProject",
    website: "https://www.openproject.org",
    license:
      "GPL-3.0 for the free Community edition. Enterprise plans (Basic, Professional, Premium, Corporate) add features on top of it.",
    licenseShort: "GPL-3.0, plus paid editions",
    hosting:
      "Enterprise Cloud hosted in the EU, or self-hosted with Docker Compose, DEB/RPM packages or Helm charts. Enterprise on-premises is a token activated on a Community installation.",
    hostingShort: "Cloud or self-hosted",
    selfHosting: "Docker Compose, DEB/RPM packages, Kubernetes",
    jiraImport: "Beta, Jira Data Center only",
    pricing:
      "The Community edition is free. Enterprise plans are priced per user per month with a minimum number of users, in the cloud or on-premises; Corporate is on request.",
    sources: [
      { label: "Pricing", url: "https://www.openproject.org/pricing/" },
      {
        label: "Installation",
        url: "https://www.openproject.org/docs/installation-and-operations/installation/",
      },
      { label: "Source code", url: "https://github.com/opf/openproject" },
      {
        label: "Documents",
        url: "https://www.openproject.org/docs/user-guide/documents/",
      },
      { label: "Roadmap", url: "https://www.openproject.org/roadmap/" },
      {
        label: "Jira migration",
        url: "https://www.openproject.org/docs/installation-and-operations/jira-migration/",
      },
    ],
    reviewed: "2026-11-08",
  },
  taiga: {
    id: "taiga",
    name: "Taiga",
    website: "https://taiga.io",
    license:
      "MPL-2.0. The maintainers state Taiga stays free and open source; paid plans cover hosting and support.",
    licenseShort: "MPL-2.0",
    selfHosting: "Docker Compose",
    jiraImport: "Jira releases up to 8.5",
    hosting:
      "Taiga Cloud, a dedicated private cloud, or self-hosted with Docker Compose; paid support is available for on-premises installations.",
    hostingShort: "Cloud or self-hosted",
    pricing:
      "Self-hosting is free. Taiga Cloud has a free plan and paid plans with a flat monthly or annual fee, not a per-user price.",
    sources: [
      { label: "Features", url: "https://taiga.io/" },
      {
        label: "Deployment and pricing options",
        url: "https://taiga.io/deployment-pricing-options/",
      },
      {
        label: "Paid plans announcement",
        url: "https://community.taiga.io/t/paid-plans-are-coming-back-to-taiga/8534",
      },
      {
        label: "Self-hosting with Docker",
        url: "https://github.com/taigaio/taiga-docker",
      },
      { label: "Importers", url: "https://docs.taiga.io/importers.html" },
      {
        label: "Tenzu announcement",
        url: "https://community.taiga.io/t/launching-tenzu-taiganext-new-identity/3940",
      },
    ],
    reviewed: "2026-11-08",
  },
  jama: {
    id: "jama",
    name: "Jama Connect",
    website: "https://www.jamasoftware.com/platform/jama-connect/",
    license: "Commercial.",
    licenseShort: "Commercial",
    hosting:
      "Cloud (SaaS, including AWS GovCloud hosting) or self-hosted on Kubernetes.",
    hostingShort: "Cloud or self-hosted",
    pricing:
      "Pricing on request, with Creator, Stakeholder, Reviewer and Test Runner licenses. Free trial.",
    sources: [
      {
        label: "Jama Connect",
        url: "https://www.jamasoftware.com/platform/jama-connect/",
      },
      {
        label: "Pricing",
        url: "https://www.jamasoftware.com/platform/pricing/",
      },
      {
        label: "Deployment options",
        url: "https://www.jamasoftware.com/blog/2025/06/24/self-hosted-and-cloud-flexible-deployment-options-for-your-requirements-management-with-jama-software/",
      },
      {
        label: "Electronic signatures",
        url: "https://help.jamasoftware.com/ah/en/collaborating-with-your-team/electronic-signatures.html",
      },
    ],
    reviewed: "2026-11-08",
  },
  doors: {
    id: "doors",
    name: "IBM DOORS Next",
    website: "https://www.ibm.com/products/requirements-management",
    license: "Commercial, with authorized or floating user licenses.",
    licenseShort: "Commercial",
    hosting:
      "Web-based. IBM offers its Engineering Lifecycle Management suite as SaaS or with on-premises licenses; classic IBM DOORS is also available.",
    hostingShort: "Cloud or on-premises",
    pricing: "Contact IBM for pricing.",
    sources: [
      {
        label: "IBM Engineering Requirements Management",
        url: "https://www.ibm.com/products/requirements-management",
      },
      {
        label: "Engineering Lifecycle Management pricing",
        url: "https://www.ibm.com/products/engineering-lifecycle-management/pricing",
      },
      {
        label: "ReqIF import and export",
        url: "https://www.ibm.com/docs/en/engineering-lifecycle-management-suite/doors-next/7.0.3?topic=files-importing-exporting-reqif",
      },
    ],
    reviewed: "2026-11-08",
  },
  polarion: {
    id: "polarion",
    name: "Siemens Polarion REQUIREMENTS",
    website: "https://www.siemens.com/en-us/products/polarion/requirements/",
    license: "Commercial.",
    licenseShort: "Commercial",
    hosting:
      "Polarion ALM on-premises, or Polarion X in the cloud, managed by Siemens.",
    hostingShort: "Cloud or on-premises",
    pricing: "Contact Siemens sales.",
    sources: [
      {
        label: "Polarion",
        url: "https://www.siemens.com/en-us/products/polarion/",
      },
      {
        label: "Polarion REQUIREMENTS",
        url: "https://www.siemens.com/en-us/products/polarion/requirements/",
      },
    ],
    reviewed: "2026-11-08",
  },
  "modern-requirements": {
    id: "modern-requirements",
    name: "Modern Requirements4DevOps",
    website: "https://www.modernrequirements.com/",
    license: "Commercial.",
    licenseShort: "Commercial",
    hosting:
      "Runs inside Azure DevOps Services or Server: as a service, in a private tenant or on-premises.",
    hostingShort: "Inside Azure DevOps",
    pricing:
      "Annual named-user plans priced in a tailored proposal; reviewers and approvers need no paid seat. Free trial.",
    sources: [
      { label: "Product", url: "https://www.modernrequirements.com/" },
      {
        label: "Pricing",
        url: "https://www.modernrequirements.com/pricing/",
      },
      {
        label: "Review management",
        url: "https://www.modernrequirements.com/products/modern-requirements4devops-features/review/",
      },
    ],
    reviewed: "2026-11-08",
  },
  reqview: {
    id: "reqview",
    name: "ReqView",
    website: "https://www.reqview.com/",
    license: "Proprietary end-user license.",
    licenseShort: "Proprietary",
    hosting:
      "Desktop app for Windows, Linux (Ubuntu/Debian) and macOS, plus a web app; documents can be versioned in Git.",
    hostingShort: "Desktop and web app",
    pricing:
      "A free plan limited to one document; paid annual subscriptions per user (Pro, Team) or per floating client (Enterprise).",
    sources: [
      { label: "Product", url: "https://www.reqview.com/" },
      { label: "Pricing", url: "https://www.reqview.com/pricing/" },
      { label: "Downloads", url: "https://www.reqview.com/download/" },
      { label: "License", url: "https://www.reqview.com/eula/" },
    ],
    reviewed: "2026-11-08",
  },
  confluence: {
    id: "confluence",
    name: "Confluence with Jira",
    website: "https://www.atlassian.com/software/confluence",
    license: "Commercial, under the Atlassian Customer Agreement.",
    licenseShort: "Commercial",
    hosting:
      "Confluence Cloud. Confluence Data Center follows the same end-of-life timeline as Jira Data Center (28 March 2029).",
    hostingShort: "Cloud; Data Center ends 2029",
    pricing:
      "Free for up to 10 users; paid plans are priced per user. Jira is licensed separately.",
    sources: [
      {
        label: "Product requirements template",
        url: "https://www.atlassian.com/software/confluence/templates/product-requirements",
      },
      {
        label: "Pricing",
        url: "https://www.atlassian.com/software/confluence/pricing",
      },
      {
        label: "Data Center end of life announcement",
        url: "https://www.atlassian.com/blog/announcements/atlassian-ascend",
      },
    ],
    reviewed: "2026-11-08",
  },
  doorstop: {
    id: "doorstop",
    name: "Doorstop",
    website: "https://github.com/doorstop-dev/doorstop",
    license: "LGPL-3.0.",
    licenseShort: "LGPL-3.0",
    hosting:
      "A Python command-line tool; each requirement is a YAML file in your own version control.",
    hostingShort: "Command line, in your repository",
    pricing: "Free.",
    sources: [
      {
        label: "Repository and license",
        url: "https://github.com/doorstop-dev/doorstop",
      },
      {
        label: "Item reference",
        url: "https://github.com/doorstop-dev/doorstop/blob/develop/docs/reference/item.md",
      },
    ],
    reviewed: "2026-11-08",
  },
  strictdoc: {
    id: "strictdoc",
    name: "StrictDoc",
    website: "https://github.com/strictdoc-project/strictdoc",
    license: "Apache-2.0.",
    licenseShort: "Apache-2.0",
    hosting:
      "A Python tool that exports static HTML or runs a local web server; requirements are text files in your repository.",
    hostingShort: "Command line, in your repository",
    pricing: "Free.",
    sources: [
      {
        label: "Repository and license",
        url: "https://github.com/strictdoc-project/strictdoc",
      },
      {
        label: "User guide",
        url: "https://strictdoc.readthedocs.io/en/stable/stable/docs/strictdoc_01_user_guide.html",
      },
    ],
    reviewed: "2026-11-08",
  },
};

export function product(id: ProductId) {
  return products[id];
}
