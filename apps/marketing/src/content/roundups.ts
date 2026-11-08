import {
  product,
  type ProductId,
  type ProductProfile,
} from "@lictory/marketing/content/products";

// Alternatives and "best tools" pages: several products, each with who it suits
// and what to weigh before choosing it. Licensing, hosting and pricing come from
// the shared product profiles (content/products.ts) and their sources. Lictory
// is listed like the others, with its limitations stated just as plainly.

export type RoundupEntry = {
  product: ProductId;
  /** Markdown: what the product is, in this page's context. */
  summary: string;
  bestFor: string;
  /** What to weigh before choosing it, including its limitations. */
  considerations: string;
};

/** Product facts shown as columns of the overview table, before "Best for". */
export const glanceColumns = {
  licenseShort: "License",
  hostingShort: "Hosting",
  selfHosting: "Self-hosting",
  jiraImport: "Jira import",
} as const satisfies Partial<Record<keyof ProductProfile, string>>;

export type GlanceColumn = keyof typeof glanceColumns;

export function glanceValue(profile: ProductProfile, column: GlanceColumn) {
  return profile[column] ?? "Not documented";
}

export type Roundup = {
  path:
    | "/alternatives/jira"
    | "/self-hosted-jira-alternative"
    | "/best-requirements-management-tools";
  /** Reported with the page's calls to action. */
  page: "alternatives" | "roundup";
  /** Document title and search result headline. */
  title: string;
  description: string;
  /** Visible page heading. */
  headline: string;
  intro: string;
  /** Markdown: how the products were chosen and compared. */
  method: string;
  /** Facts in the overview table, chosen for the question the page answers. */
  columns: readonly GlanceColumn[];
  entries: readonly RoundupEntry[];
  /** Markdown sections after the products, rendered in order. */
  sections: ReadonlyArray<{ id: string; title: string; body: string }>;
  faqs: ReadonlyArray<{ question: string; answer: string }>;
  /** ISO date of the last material content change. */
  updated: string;
};

export const roundups: readonly Roundup[] = [
  {
    path: "/alternatives/jira",
    page: "alternatives",
    title:
      "Open-source Jira alternatives: Lictory, Plane, OpenProject and Taiga",
    description:
      "Four open-source alternatives to Jira compared on license, hosting, pricing model, features and Jira import, with who each one suits best.",
    headline: "Open-source Jira alternatives",
    intro:
      "If you want to replace Jira with software you can read, run and change yourself, four open-source tools come up most often for software teams: Lictory, Plane, OpenProject and Taiga. They differ more than their feature lists suggest: in license, in what their paid editions hold back, in how they import from Jira, and in what they treat as the core of the work.",
    method: `We make Lictory, so read this with that in mind. We included open-source tools that software teams commonly evaluate as Jira replacements and that publish their source code under an open-source license.

Every fact about another product comes from its own website, documentation or repository, linked under Sources at the end. Where we could not confirm something there, we left it out. We list Lictory's limitations as plainly as the others'.`,
    columns: ["licenseShort", "hostingShort", "jiraImport"],
    entries: [
      {
        product: "lictory",
        summary: `Lictory is open-source work management built around one idea: **requirements are reviewed like code**. A specification changes through immutable revisions; reviewers discuss the exact text, accept or reject suggested wording and approve a specific revision; readiness checks show when work can start.

Delivery runs natively (a board, a ranked backlog, sprints or automatic cycles, estimates, burndown, velocity and relations) or is handed off to Jira Cloud.`,
        bestFor:
          "Software teams whose problem with Jira is unclear requirements and untraceable sign-off, not ticket tracking.",
        considerations:
          "No Gantt charts, time tracking, custom fields or portfolio planning, by design. No Jira importer yet, no hosted cloud, and single sign-on through OpenID Connect only (no SAML or SCIM).",
      },
      {
        product: "plane",
        summary: `Plane is a broad, modern project tool: work items, cycles, modules, several layouts including Gantt, pages, intake and dashboards. It runs as Plane Cloud or on your own servers, with an AGPL-3.0 Community Edition and a Commercial Edition.`,
        bestFor:
          "Teams that want a full-featured, Jira-style tracker with a cloud option and an importer for their Jira history.",
        considerations:
          "Plane says its Commercial Edition adds workflows, approvals, SSO and audit trails, and the Jira importer is not available in the self-hosted Community Edition. On Plane Cloud, the free plan covers up to 12 users.",
      },
      {
        product: "openproject",
        summary: `OpenProject is a long-established suite for classic, agile and hybrid project management: work packages, Gantt charts, agile boards, time and cost reporting, wikis, meetings and, in Enterprise plans, portfolio management.`,
        bestFor:
          "Organizations that need scheduling, time and cost tracking or portfolio views, including projects beyond software.",
        considerations:
          "Enterprise features need a paid plan with a minimum number of users. Its Jira migrator is in beta and supports Jira Data Center, not Jira Cloud. Its Documents module has no versioning today.",
      },
      {
        product: "taiga",
        summary: `Taiga is an agile tool with a Scrum backlog, sprints and burndown, a Kanban board with swimlanes and WIP limits, epics, issues, a wiki and custom fields.`,
        bestFor:
          "Teams that want a simple Scrum or Kanban tool, self-hosted or on a flat-priced cloud plan.",
        considerations:
          "Its Jira importer supports Jira releases up to 8.5. The planned successor once called Taiga Next continues as a separate project, Tenzu, so check the project's direction before committing for the long term.",
      },
    ],
    sections: [
      {
        id: "why",
        title: "Why teams look for an open-source Jira alternative",
        body: `- **Control over data and hosting.** Self-managed Jira Data Center is no longer sold to new customers since 30 March 2026 and reaches end of life on 28 March 2029, so teams that must self-host are choosing what comes next. See [self-hosted Jira alternatives](/self-hosted-jira-alternative).
- **Cost.** Open-source editions are free to run; you pay for servers and, if you choose, paid editions or support.
- **Adaptability.** You can read the code, fix what bothers you and contribute it back.
- **A different workflow.** Some teams are not short of ticket fields; they are short of agreement on what the tickets mean.`,
      },
      {
        id: "licenses",
        title: "Licenses at a glance",
        body: `The four use different open-source licenses. This is a summary, not legal advice:

- **MIT** (Lictory): permissive. Use, modify and redistribute with the copyright notice, with no obligation to publish your changes.
- **MPL-2.0** (Taiga): file-level copyleft. Changes to MPL-licensed files must be shared when you distribute them; your own separate files can stay private.
- **GPL-3.0** (OpenProject): copyleft. Distributing a modified version requires publishing its source under the GPL.
- **AGPL-3.0** (Plane Community Edition): copyleft that also covers network use. Offering a modified version to users over a network requires making its source available to them.

Also check what the open-source edition contains. Plane and OpenProject sell editions with additional features. Taiga's paid plans are for hosting and support, and Lictory has a single edition with every feature.`,
      },
      {
        id: "with-jira",
        title: "Not ready to leave Jira?",
        body: `Lictory can sit in front of Jira instead of replacing it. Set a project to external delivery: specifications are refined, reviewed and approved in Lictory, then ready work is handed off to Jira Cloud with a link back to the approved revision.

After hand-off, Jira owns status, assignee and sprint, and edits to the published text in Jira are held as conflicts instead of being overwritten. [Lictory vs Jira](/compare/jira) explains how the two divide the work.`,
      },
    ],
    faqs: [
      {
        question: "What is the best open-source alternative to Jira?",
        answer:
          "It depends on what you need from Jira. For a broad tracker with Gantt views and a cloud option, Plane. For full project management with time, costs and portfolios, OpenProject. For simple Scrum and Kanban, Taiga. For reviewing and approving requirements before delivery, with boards and sprints included, Lictory.",
      },
      {
        question:
          "Which open-source Jira alternatives can import Jira projects?",
        answer:
          "Plane (on Plane Cloud and its Commercial Edition), OpenProject (a beta migrator for Jira Data Center) and Taiga (Jira releases up to 8.5) document importers. Lictory has no importer yet.",
      },
      {
        question: "Are open-source Jira alternatives really free?",
        answer:
          "Their open-source editions are free to self-host. Plane and OpenProject also sell editions with more features, and Plane, OpenProject and Taiga sell hosted plans. Lictory has no paid edition and no cloud: it is free, and you run it yourself.",
      },
      {
        question: "Can I keep Jira and still use Lictory?",
        answer:
          "Yes. Lictory projects set to external delivery hand approved work off to Jira Cloud. Self-managed Jira Data Center is not supported as a target yet.",
      },
    ],
    updated: "2026-11-08",
  },
  {
    path: "/self-hosted-jira-alternative",
    page: "alternatives",
    title: "Self-hosted Jira alternatives after Data Center end of life",
    description:
      "Jira Data Center reaches end of life in March 2029. What self-hosting Lictory, OpenProject, Plane and Taiga involves, how each imports from Jira, and what to check before you move.",
    headline: "Self-hosted Jira alternatives",
    intro:
      "Atlassian stopped selling Jira Data Center to new customers on 30 March 2026, and Data Center licenses expire and become read-only on 28 March 2029. If your work management has to stay on your own servers, for regulation, data residency or policy, these are the open-source options to evaluate, judged on what running them yourself involves.",
    method: `We make Lictory. This page compares tools on what matters when you operate them yourself: how they install, what the self-hosted edition includes, how they import from Jira and what they cost to run.

Facts about other products come from their own documentation, linked under Sources. Check the details against your own requirements: a migration is a project, not a checkbox.`,
    columns: ["selfHosting", "jiraImport"],
    entries: [
      {
        product: "lictory",
        summary: `Lictory is only self-hosted, so running it yourself is its primary path rather than an afterthought. One Linux server (amd64 or arm64) with Docker Engine and Docker Compose runs the whole installation.

The \`lictory\` command installs a verified release, checks the server, takes and restores backups, upgrades and rolls back. PostgreSQL runs in a container by default, or on your own or a managed PostgreSQL server.`,
        bestFor:
          "Teams that want every feature in the self-hosted edition and a short operations runbook.",
        considerations:
          "An installation is one server. Sign-in through OpenID Connect providers, without SAML or SCIM. No Jira importer, and hand-off to Jira supports Jira Cloud only, not Data Center.",
      },
      {
        product: "openproject",
        summary: `OpenProject installs with Docker Compose, DEB/RPM packages for common Linux distributions or Helm charts for Kubernetes. Enterprise on-premises features are enabled by adding a token to a Community installation, so you can start free and upgrade in place.`,
        bestFor:
          "Organizations replacing Jira and their planning tools on-premises: Gantt, time and cost tracking, portfolios.",
        considerations:
          "Its Jira migrator is in beta and documented for Jira Data Center 10.x and 11.x; issue relations and sprints are not migrated yet. Enterprise plans have minimum user counts.",
      },
      {
        product: "plane",
        summary: `Plane's Community Edition self-hosts with Docker Compose, Kubernetes with Helm, Podman or one-click platforms such as Coolify and Portainer. Plane lists air-gapped deployment among the additions of its Commercial Edition.`,
        bestFor:
          "Teams that want a Jira-like tracker on their own infrastructure, including air-gapped environments, and plan to buy the Commercial Edition.",
        considerations:
          "The Jira importer, workflows, approvals and SSO belong to the Commercial Edition, not the free Community Edition.",
      },
      {
        product: "taiga",
        summary: `Taiga self-hosts with Docker Compose from its taiga-docker repository, using the stable branch for production. Paid support with a service-level agreement is available for on-premises installations.`,
        bestFor:
          "Small agile teams that want a lightweight Scrum or Kanban tool on their own server.",
        considerations:
          "Its Jira importer does not support Jira 8.6 or later. Work on a successor continues separately as Tenzu.",
      },
    ],
    sections: [
      {
        id: "timeline",
        title: "The Jira Data Center timeline",
        body: `- **15 February 2024:** support for Jira Server ended.
- **30 March 2026:** Data Center subscriptions and Marketplace apps are no longer sold to new customers.
- **30 March 2028:** the last date for existing customers to buy new licenses, apps or license expansions.
- **28 March 2029:** end of life. Data Center licenses and their Marketplace app licenses expire and become read-only.

Atlassian's path forward is Jira Cloud. If your data has to stay on servers you control, plan a self-hosted alternative well before 2029.`,
      },
      {
        id: "checklist",
        title: "What to check before you move",
        body: `1. **Identity.** Which sign-in protocols you need (OpenID Connect, SAML, LDAP), and whether you need user provisioning (SCIM).
2. **The free edition.** Which features you rely on are in the free self-hosted edition, and which need a paid one.
3. **Migration.** Whether the importer supports your Jira version and the data you care about: history, attachments, relations, sprints. Run it on a copy first.
4. **Operations.** Who installs upgrades, how backups are taken and restored, and how the service is monitored.
5. **Workflow fit.** Jira configurations accumulate. Moving is a chance to keep only the statuses, fields and rules you actually use.`,
      },
      {
        id: "running-lictory",
        title: "What running Lictory involves",
        body: `- **Server:** Linux on amd64 or arm64, with Docker Engine 25.0 or later and Docker Compose v2.24 or later.
- **Memory:** 2 GB minimum, 4 GB recommended.
- **Disk:** 10 GB free (20 GB recommended), plus your data.
- **Network:** ports 80 and 443 and a DNS name for the server; certificates are issued automatically, or you put Lictory behind your own reverse proxy.
- **Install:** \`curl -fsSL https://raw.githubusercontent.com/chricarp/lictory/main/deploy/get.sh | sudo sh\`, then \`sudo lictory install\`.

Releases are checked against the digests published with them before anything runs. Backups, restores, upgrades and rollbacks are commands of the same tool, and your data stays on the server unless you configure a service that needs it, such as an AI provider or email. The [installation guide](https://docs.lictory.com/self-hosting/install) has the details.`,
      },
      {
        id: "moving",
        title: "Moving without a big bang",
        body: `Lictory has no Jira importer, so a team leaving Data Center usually starts new work in Lictory and lets Jira wind down: new proposals are refined, approved and delivered natively in Lictory while existing tickets finish where they are.

Lictory's hand-off to Jira supports Jira Cloud only. It helps teams that move to Jira Cloud and want reviewed requirements in front of it, not teams that stay on Data Center in the meantime.`,
      },
    ],
    faqs: [
      {
        question: "When does Jira Data Center reach end of life?",
        answer:
          "On 28 March 2029, when Data Center licenses and their Marketplace app licenses expire and become read-only. Data Center stopped being sold to new customers on 30 March 2026, and existing customers can buy new licenses or expansions until 30 March 2028.",
      },
      {
        question: "Will there be a self-hosted Jira after 2029?",
        answer:
          "Atlassian's announced path is Jira Cloud. Atlassian says it may offer extended maintenance by exception after 28 March 2029.",
      },
      {
        question:
          "Which self-hosted alternatives import from Jira Data Center?",
        answer:
          "OpenProject documents a beta migrator for Jira Data Center 10.x and 11.x. Plane's importer supports Jira Server and Data Center in its Commercial Edition. Taiga supports Jira up to release 8.5. Lictory has no importer.",
      },
      {
        question: "Does Lictory need Kubernetes?",
        answer:
          "No. An installation is one Linux server with Docker Compose. Any compatible PostgreSQL, including managed services, can replace the bundled database.",
      },
    ],
    updated: "2026-11-08",
  },
  {
    path: "/best-requirements-management-tools",
    page: "roundup",
    title: "Best requirements management tools in 2026, compared honestly",
    description:
      "Nine requirements management tools compared on who they suit, licensing, hosting and pricing model: Lictory, Jama Connect, IBM DOORS Next, Polarion, Modern Requirements4DevOps, ReqView, Confluence, Doorstop and StrictDoc.",
    headline: "Best requirements management tools",
    intro:
      "Requirements management covers very different needs. A medical device maker needs traceability, baselines and electronic signatures for an audit; a SaaS team needs product, engineering and QA to agree on a feature before the sprint starts. No tool is best at both. This comparison groups the options by the job they do, including where Lictory is the wrong choice.",
    method: `We make Lictory, so we are not neutral. To keep this useful anyway, we describe each tool by what its vendor says it is for, take every fact from the vendor's own website, documentation or repository (linked under Sources), and leave out what we could not confirm there. There are no scores: the right choice depends on whether you work under a regulatory standard, in which ecosystem, and who reviews your requirements.

The tools fall into four groups:

- **Review-driven requirements for software teams:** Lictory.
- **Regulated and systems engineering:** Jama Connect, IBM DOORS Next, Siemens Polarion REQUIREMENTS.
- **Inside an existing ecosystem:** Modern Requirements4DevOps (Azure DevOps), Confluence with Jira.
- **Documents and requirements as files:** ReqView, Doorstop, StrictDoc.`,
    columns: ["licenseShort", "hostingShort"],
    entries: [
      {
        product: "lictory",
        summary: `Lictory treats a requirement like a code change. Specifications are changed on branches and reviewed through pull requests; every accepted change is an immutable revision; discussions attach to the exact text; approvals belong to a revision and go stale when it changes materially; readiness checks, such as no open blocking discussions and every required review approved, show when work can start.

Approved specifications become delivery work in Lictory or are handed off to Jira Cloud, each item linked to the revision it came from.`,
        bestFor:
          "Software product teams that need product, engineering and QA to agree on requirements before development.",
        considerations:
          "Not built for regulated systems engineering: no electronic signatures, ReqIF exchange or compliance templates. Only self-hosted, and it cannot import existing requirements yet.",
      },
      {
        product: "jama",
        summary: `Jama Connect is a requirements and engineering management platform for industries such as aerospace and defense, automotive, medical technology and semiconductors. It offers traceability, baselines, and reviews that can be approved with electronic signatures, and exchanges requirements over ReqIF through an add-on. Jama names standards such as ISO 26262, DO-178C and FDA 21 CFR Part 11 on its product page.`,
        bestFor:
          "Regulated product development that needs end-to-end traceability and signed reviews.",
        considerations:
          "Pricing is on request. More process than a software team needs if it does not work under a compliance standard.",
      },
      {
        product: "doors",
        summary: `IBM DOORS Next, part of IBM Engineering Requirements Management, is aimed at complex, high-compliance systems engineering programs. It supports traceability, baselines that can be signed electronically, and ReqIF import and export; IBM names standards such as ASPICE, ISO 26262 and DO-178C. The classic IBM DOORS remains available alongside it.`,
        bestFor:
          "Large systems engineering programs, especially where DOORS is already the customer or industry standard.",
        considerations:
          "Pricing through IBM. It fits best together with the rest of IBM's Engineering Lifecycle Management suite.",
      },
      {
        product: "polarion",
        summary: `Siemens Polarion REQUIREMENTS is for gathering, authoring, approving and managing requirements for complex systems. It includes workflows, an audit trail, electronic signatures to mark documents as reviewed or approved, and built-in ReqIF exchange. Siemens positions Polarion for large-scale, compliance-heavy product development.`,
        bestFor:
          "Compliance-heavy development that wants requirements, tests and lifecycle management in one platform.",
        considerations:
          "Pricing through Siemens sales. Choose between Polarion ALM on-premises and Polarion X in Siemens' cloud.",
      },
      {
        product: "modern-requirements",
        summary: `Modern Requirements4DevOps is built into Azure DevOps Services and Server. It adds requirements authoring, traceability matrices, baselines and review management, with approvals that ask for the password again (which the vendor says satisfies FDA 21 CFR Part 11) and approval audit reports exported to Word or PDF.`,
        bestFor:
          "Teams that already plan and build in Azure DevOps and need formal requirements and reviews there.",
        considerations:
          "Only useful with Azure DevOps. Plans are annual and priced in a tailored proposal.",
      },
      {
        product: "reqview",
        summary: `ReqView is a requirements tool for hardware, software and systems engineers, with traceability, document templates (such as ISO/IEC/IEEE 29148) and documents that can be versioned in Git. It runs as a desktop app on Windows, Linux and macOS, and as a web app.`,
        bestFor:
          "Small engineering teams that want structured requirements documents with traceability at a published price.",
        considerations:
          "Proprietary, with a free plan limited to one document. Check its review and approval features against your process; we could not confirm them from its public pages.",
      },
      {
        product: "confluence",
        summary: `Many software teams keep requirements as Confluence pages linked to Jira issues. Atlassian's product requirements template covers objectives, success metrics, assumptions, a requirements table with user stories and linked Jira issues, open questions and what is out of scope.`,
        bestFor:
          "Teams already on Atlassian Cloud whose requirements are documents that point to Jira issues.",
        considerations:
          "The template is a page, not a review workflow: it has no approvals tied to a version and no readiness checks. Confluence and Jira Data Center reach end of life in March 2029.",
      },
      {
        product: "doorstop",
        summary: `Doorstop manages requirements in version control: each item is a YAML file in your repository. It validates traceability between documents, flags unreviewed changes and suspect links through review fingerprints, and publishes documents in several formats.`,
        bestFor:
          "Engineering teams that want requirements reviewed in the same Git pull requests as their code.",
        considerations:
          "A command-line tool for people comfortable with Git and YAML; product managers and QA without that background will need help.",
      },
      {
        product: "strictdoc",
        summary: `StrictDoc is open-source software for technical documentation and requirements written in \`.sdoc\` text files. It exports to HTML, PDF, ReqIF, JSON and Excel among other formats, imports ReqIF, and offers templates for DO-178C and ECSS-E-ST-40C. Traceability to source files is marked experimental.`,
        bestFor:
          "Engineering teams that want open, text-based requirements with ReqIF exchange and no license cost.",
        considerations:
          "Its web editing interface is still a work in progress, so it suits people who work in text files and repositories.",
      },
    ],
    sections: [
      {
        id: "choose",
        title: "How to choose",
        body: `Start from your constraints, not the feature lists:

1. **Do you work under a safety or regulatory standard?** If auditors expect traceability, baselines and electronic signatures, start with Jama Connect, IBM DOORS Next, Polarion or, on Azure DevOps, Modern Requirements4DevOps.
2. **Where does delivery happen?** Tools that live beside your tracker (Modern Requirements in Azure DevOps, Confluence with Jira) reduce friction. Lictory delivers natively or hands work off to Jira Cloud.
3. **Who writes and reviews requirements?** If product managers, QA and engineers all review, choose a tool all of them will use; text files in Git suit engineers best.
4. **What actually goes wrong?** If work starts on requirements nobody fully agreed to, you need review and approval, not just storage. That is the problem Lictory is built for.
5. **Hosting and budget.** Open-source tools (Lictory, Doorstop, StrictDoc) cost nothing to license; commercial suites usually start with a sales conversation.`,
      },
      {
        id: "software-teams",
        title: "Requirements management for software teams",
        body: `Classic requirements management grew up in systems engineering: requirement IDs, traceability matrices, baselines and signatures. Software product teams rarely need all of that, but they share its core concern: being able to say what was agreed, by whom, and what changed since.

Lictory brings that discipline to software teams in the form they already know from code review: revisions and diffs instead of baselines, pull requests and anchored discussions instead of review meetings, approvals bound to a revision instead of a signature on a document, and readiness checks as CI for requirements. The [Definition of Ready guide](/guides/definition-of-ready) shows what such checks can look like.`,
      },
    ],
    faqs: [
      {
        question: "What is a requirements management tool?",
        answer:
          "Software for writing, reviewing, approving and tracing requirements: what a product must do and why. Depending on the tool, that ranges from structured documents and traceability for regulated industries to review workflows that get a team to agree on a specification before development.",
      },
      {
        question: "Which requirements management tools are open source?",
        answer:
          "In this comparison: Lictory (MIT), Doorstop (LGPL-3.0) and StrictDoc (Apache-2.0). Jama Connect, IBM DOORS Next, Polarion, Modern Requirements4DevOps, ReqView and Confluence are commercial.",
      },
      {
        question: "Which tools support electronic signatures?",
        answer:
          "Jama Connect, IBM DOORS Next and Polarion REQUIREMENTS document electronic signatures on reviews, baselines or documents, and Modern Requirements4DevOps asks for the password again on approval. Lictory does not offer electronic signatures.",
      },
      {
        question: "Is Jira a requirements management tool?",
        answer:
          "Jira tracks work items. Teams often keep requirements in Confluence pages or issue descriptions linked to Jira, or add a dedicated tool in front of it. Lictory reviews and approves specifications and then hands the work off to Jira Cloud.",
      },
      {
        question: "Can I use Lictory without changing my tracker?",
        answer:
          "If your tracker is Jira Cloud, yes: set the project to external delivery and Lictory hands approved work off to Jira. Publishing to Linear is coming; other trackers are not supported yet.",
      },
    ],
    updated: "2026-11-08",
  },
];

export function roundup(path: string) {
  return roundups.find((item) => item.path === path);
}

/** Roundups served by the /alternatives/[slug] route, by slug. */
export function alternativesSlug(item: Roundup) {
  return item.path.startsWith("/alternatives/")
    ? item.path.slice("/alternatives/".length)
    : undefined;
}

export function roundupProducts(item: Roundup): ProductProfile[] {
  return item.entries.map((entry) => product(entry.product));
}

/**
 * The oldest check of any listed product's facts: the page is only as current
 * as its least recently reviewed entry.
 */
export function roundupReviewed(item: Roundup) {
  return roundupProducts(item)
    .map((profile) => profile.reviewed)
    .sort()[0];
}
