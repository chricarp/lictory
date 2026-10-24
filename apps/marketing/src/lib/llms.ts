import { comparisons } from "@lictory/marketing/content/comparisons";
import { guides } from "@lictory/marketing/content/guides";
import {
  comparisonCellText,
  comparisonProducts,
  comparisonRows,
  faqs,
} from "@lictory/marketing/components/landing/content";
import {
  comparisonMarkdown,
  demoteHeadings,
  guideMarkdown,
  hasMarkdown,
  markdownPath,
} from "@lictory/marketing/lib/markdown";
import {
  absoluteUrl,
  guidesFeedPath,
  publicPages,
  siteName,
  siteSummary,
  siteTagline,
} from "@lictory/marketing/lib/site";

// Markdown overviews for AI assistants, following https://llmstxt.org. Built from
// the same copy as the landing page and only from public facts about the product.

// Pages with a Markdown version link to it, as the llms.txt convention suggests;
// each Markdown document names its canonical HTML URL.
function pageLinks() {
  return publicPages
    .map(
      ({ path, title, description }) =>
        `- [${title}](${absoluteUrl(hasMarkdown(path) ? markdownPath(path) : path)}): ${description}`,
    )
    .join("\n");
}

const overview = `# ${siteName}

> ${siteSummary}

${siteName}: ${siteTagline} It exists to close the gap between “Product wants to build this” and “Engineering can safely commit to building this.” A product owner creates a rough proposal, the right reviewers are involved, product, engineering and QA collaborate asynchronously to resolve ambiguity, and the team reaches an agreed specification that is decomposed into delivery work.`;

const concepts = `## How ${siteName} works

1. **Draft.** Start from a problem statement, notes or an existing ticket. Proposals may begin incomplete. ${siteName} shapes them into objective, behavior and acceptance criteria and flags what is missing.
2. **Review.** Threads attach to the exact text they discuss. Suggestions are real text changes that reviewers accept or reject; each accepted suggestion creates a new revision. Product, engineering, QA, security and operations review the same specification, each with the concerns they know best.
3. **Readiness.** Readiness is evidence, not a status label: checks such as “acceptance criteria present”, “failure behavior addressed” and “no blocking threads” pass as answers arrive. Think of it as CI for requirements.
4. **Approval.** Approvals belong to the revision that was reviewed. When approved content changes materially, the affected approvals go stale and need another review.
5. **Delivery.** Each project chooses where delivery happens: natively in ${siteName} (configurable work item types, workflows, boards, backlog, sprints, cycles, estimates, burndown, velocity and relations) or by publishing approved work to Jira (Linear support is coming) with a link back to the revision it came from. Publishing is an explicit, permission-checked action.

## Key concepts

- **Proposal**: the initial, possibly incomplete expression of a desired product change.
- **Specification**: the structured, evolving description of the behavior being agreed.
- **Revision**: an immutable snapshot of specification content, enabling history, diffs and approval tracking.
- **Thread**: a discussion anchored to a text range, section, revision or suggestion; it can be blocking and is resolved without deleting history.
- **Suggestion**: a proposed text change that can be accepted (creating a revision) or rejected.
- **Approval**: a reviewer’s decision that a specific revision satisfies their responsibility.
- **Check**: an automated readiness evaluation, informative or blocking according to project policy.
- **Decision**: a durable record of a conclusion reached during refinement.

## Lictory Intelligence

Lictory Intelligence is the umbrella for AI-assisted features, including automated reviews and shared context. Litto is the conversational assistant, powered by Lictory Intelligence and its context. Lictory Intelligence finds missing information, contradictions, ambiguity and edge cases, and proposes acceptance criteria, rewrites and delivery decomposition. Its output is always a proposal: people decide what becomes part of the specification, and it never silently rewrites, resolves, approves or publishes. All core collaboration keeps working when it is disabled.`;

function comparison() {
  const header = `| Capability | ${comparisonProducts.map((p) => p.label).join(" | ")} |`;
  const divider = `| --- | ${comparisonProducts.map(() => "---").join(" | ")} |`;
  const rows = comparisonRows.map(
    (row) =>
      `| ${row.feature} | ${comparisonProducts
        .map((p) => comparisonCellText[row[p.key]])
        .join(" | ")} |`,
  );
  return `## ${siteName} compared with Jira and Linear

Built-in capabilities as we understand them; marketplace add-ons and integrations may change the picture.

${[header, divider, ...rows].join("\n")}`;
}

function guideArticles() {
  return `## Guides

${guides.map((guide) => demoteHeadings(guideMarkdown(guide), 2)).join("\n\n")}`;
}

function comparisonArticles() {
  return `## Detailed comparisons

${comparisons.map((item) => demoteHeadings(comparisonMarkdown(item), 2)).join("\n\n")}`;
}

function faq() {
  return `## Frequently asked questions

${faqs.map(({ question, answer }) => `### ${question}\n\n${answer}`).join("\n\n")}`;
}

/** The short index served at /llms.txt. */
export function llmsIndex() {
  return `${overview}

## Pages

${pageLinks()}

## Optional

- [Full product overview](${absoluteUrl("/llms-full.txt")}): how ${siteName} works, key concepts, comparison with Jira and Linear, frequently asked questions and the full text of the comparisons and guides.
- [Guides feed](${absoluteUrl(guidesFeedPath)}): RSS feed of new and updated guides.
`;
}

/** The complete overview served at /llms-full.txt. */
export function llmsFull() {
  return `${overview}

${concepts}

${comparison()}

${faq()}

${comparisonArticles()}

${guideArticles()}

## Pages

${pageLinks()}
`;
}
