import { comparisons } from "@lictory/marketing/content/comparisons";
import { guides } from "@lictory/marketing/content/guides";
import { roundups } from "@lictory/marketing/content/roundups";
import {
  autonomyLevels,
  comparisonCellText,
  comparisonProducts,
  comparisonRows,
  faqs,
  harnesses,
  loopStages,
  modules,
  stackRows,
  trustPrinciples,
} from "@lictory/marketing/components/landing/content";
import {
  comparisonMarkdown,
  demoteHeadings,
  guideMarkdown,
  hasMarkdown,
  markdownPath,
  roundupMarkdown,
} from "@lictory/marketing/lib/markdown";
import {
  downloadPath,
  installUrl,
  repositoryUrl,
  tryUrl,
} from "@lictory/marketing/lib/get-started";
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

${siteName}: ${siteTagline} Team chat with agents as members, review-driven specifications, delivery, coding agents on runners the team controls, code host integration and knowledge pages, in one product. An approved specification is the contract agents and people work against.`;

const concepts = `## How ${siteName} works

Every piece of work follows one loop. Agents do the work inside each stage; moving past a gate is a recorded act by a person, or evidence.

${loopStages
  .map(
    (stage, index) =>
      `${index + 1}. **${stage.name}: ${stage.title}.** ${stage.body} Gate: ${stage.gate.text}`,
  )
  .join("\n")}

## Modules

${modules
  .map(
    (module) =>
      `- **${module.name}**: ${module.summary} ${module.features.join(". ")}.`,
  )
  .join("\n")}

## Specifications reviewed like code

1. **Draft and branch.** Start from a problem statement, notes or a channel message; proposals may begin incomplete. People and agents explore changes on branches without overwriting the agreed specification.
2. **Review.** A pull request brings changes back for review. Threads attach to the exact text they discuss. Suggestions are text changes reviewers accept or reject; each accepted suggestion creates a revision. Product, engineering, QA, security and operations review the same specification.
3. **Readiness.** Readiness is evidence, not a status label: checks such as “acceptance criteria present”, “failure behavior addressed” and “no blocking threads”. CI for requirements.
4. **Approval.** Approvals belong to the reviewed revision. A material change makes the affected approvals stale.
5. **Delivery.** Each project delivers natively in ${siteName} (work item types, workflows, boards, backlog, sprints, cycles, estimates, burndown, velocity and relations) or publishes approved work to Jira (Linear is coming) with a link back to its revision.

## Key concepts

- **Proposal**: the initial, possibly incomplete expression of a desired product change.
- **Specification**: the structured, evolving description of the behavior being agreed.
- **Revision**: an immutable snapshot of specification content, enabling history, diffs and approval tracking.
- **Thread**: a discussion anchored to a text range, section, revision or suggestion; it can be blocking and is resolved without deleting history.
- **Suggestion**: a proposed text change that can be accepted (creating a revision) or rejected.
- **Approval**: a reviewer’s decision that a specific revision satisfies their responsibility.
- **Check**: an automated readiness evaluation, informative or blocking according to project policy.
- **Decision**: a durable record of a conclusion reached during refinement.
- **Channel**: a named conversation with people and agents as members; what matters is promoted into a proposal, a decision or an anchored discussion.
- **Agent**: a named, non-human member with an accountable owner and a scope; it never has more access than its owner.
- **Agent session**: one run of an agent on one task, with a status, an event log and a thread to steer it.
- **Runner**: a machine running lictory-runner that executes agent sessions in isolated git worktrees, connecting out over HTTPS.
- **Definition of Done**: a project's delivery checks (linked pull request merged, required checks passed) that move an item to done.

## The factory

A runner is a Linux, macOS or Windows machine (x64 or arm64) running lictory-runner. It connects out over HTTPS and needs no open port. It executes ${harnesses.slice(0, -1).join(", ")} or ${harnesses.at(-1)}, each session in its own git worktree with short-lived, repository-scoped credentials. Agents claim only items the readiness policy allows to start, and ask a person in the session's thread when they need an answer or a permission.

Each project chooses an autonomy policy:

${autonomyLevels.map((level) => `- **${level.name}**${level.isDefault ? " (default)" : ""}: ${level.body}`).join("\n")}

Code hosts (GitHub, GitLab, Bitbucket; cloud or self-managed) own every mirrored field. Lictory links branches, pull requests, issues and commits to work items and writes to the host only through explicit commands.

## Agents you can trust

${trustPrinciples.map((principle) => `- **${principle.title}.** ${principle.body}`).join("\n")}

Work in the UI, delegate to Litto, or connect your own agent through MCP: the same capabilities and permission checks apply everywhere.

## Lictory Spaces

Lictory Spaces keeps runbooks, architecture notes and handbooks in spaces of nested pages. A space belongs to the organization, a project or a team, or is Restricted to named people. Several people edit a page's live draft at once. In a Direct space editors publish the draft as a new version; in a Reviewed space changes arrive as pull requests that merge after the required approvals. Published versions never change and can be compared word by word. Comments stay anchored to the text they quote, pages mention work items with their live status, and agents propose page changes as pull requests, never in live drafts.

## Lictory Intelligence

Lictory Intelligence covers the AI-assisted features; Litto is its conversational assistant. It finds missing information, contradictions, ambiguity and edge cases, and proposes acceptance criteria, rewrites and delivery decomposition. Its output is always a proposal: people decide, and it never silently rewrites, resolves, approves or publishes. Core collaboration works with it disabled.`;

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

Built-in capabilities as we understand them. Add-ons may change the picture.

${[header, divider, ...rows].join("\n")}`;
}

function stackComparison() {
  return `## ${siteName} compared with a stack of separate tools

| Need | Separate tools | ${siteName} |
| --- | --- | --- |
${stackRows.map((row) => `| ${row.need} | ${row.stack} | ${row.lictory} |`).join("\n")}`;
}

function guideArticles() {
  return `## Guides

${guides.map((guide) => demoteHeadings(guideMarkdown(guide), 2)).join("\n\n")}`;
}

function comparisonArticles() {
  return `## Detailed comparisons

${comparisons.map((item) => demoteHeadings(comparisonMarkdown(item), 2)).join("\n\n")}`;
}

function roundupArticles() {
  return `## Alternatives and roundups

${roundups.map((item) => demoteHeadings(roundupMarkdown(item), 2)).join("\n\n")}`;
}

const projectLinks = `## Project

- [Source code on GitHub](${repositoryUrl}): the MIT-licensed repository, releases and issues.
- [Documentation](https://docs.lictory.com): using, self-hosting and connecting agents.
- [Try Lictory in 5 minutes](${tryUrl}): one command and Docker on your own computer.
- [Installation guide](${installUrl}): install Lictory on a Linux server.
- [Download](${absoluteUrl(downloadPath)}): the desktop app and lictory-runner, newest stable release.`;

function faq() {
  return `## Frequently asked questions

${faqs.map(({ question, answer }) => `### ${question}\n\n${answer}`).join("\n\n")}`;
}

/** The short index served at /llms.txt. */
export function llmsIndex() {
  return `${overview}

## Pages

${pageLinks()}

${projectLinks}

## Optional

- [Full product overview](${absoluteUrl("/llms-full.txt")}): how ${siteName} works, key concepts, comparisons, frequently asked questions and the full text of every comparison, roundup and guide.
- [Guides feed](${absoluteUrl(guidesFeedPath)}): RSS feed of new and updated guides.
`;
}

/** The complete overview served at /llms-full.txt. */
export function llmsFull() {
  return `${overview}

${concepts}

${stackComparison()}

${comparison()}

${faq()}

${comparisonArticles()}

${roundupArticles()}

${guideArticles()}

## Pages

${pageLinks()}

${projectLinks}
`;
}
