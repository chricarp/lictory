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

${siteName}: ${siteTagline} It brings together team chat with agents as members, review-driven specifications, delivery, coding agents on runners the team controls, code host integration and knowledge pages, so a team does not need to stitch five tools together. Its distinguishing feature remains collaborative, review-driven requirements refinement: an approved specification is the contract agents and people work against.`;

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

1. **Draft and branch.** Start from a problem statement, notes or a message in a channel. Proposals may begin incomplete. Explore changes on specification branches so people and agents can contribute concurrently without silently overwriting the agreed specification.
2. **Review.** Open a pull request to bring proposed changes back for review. Threads attach to the exact text they discuss. Suggestions are real text changes that reviewers accept or reject; each accepted suggestion creates a new revision. Product, engineering, QA, security and operations review the same specification, each with the concerns they know best.
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
- **Channel**: a named conversation with people and agents as members; what matters is promoted into a proposal, a decision or an anchored discussion.
- **Agent**: a named, non-human member with an accountable owner and a scope; it never has more access than its owner.
- **Agent session**: one run of an agent on one task, with a status, an event log and a thread to steer it.
- **Runner**: a machine running lictory-runner that executes agent sessions in isolated git worktrees, connecting out over HTTPS.
- **Definition of Done**: a project's delivery checks (linked pull request merged, required checks passed) that move an item to done.

## The factory

A runner is a Linux, macOS or Windows machine (x64 or arm64) running lictory-runner: a server, a VPS, a laptop or a Mac. It connects out to the Lictory server over HTTPS and needs no open port. It executes ${harnesses.slice(0, -1).join(", ")} or ${harnesses.at(-1)}, each session in its own git worktree, with short-lived, repository-scoped credentials issued for that session. Agents claim only native delivery items the readiness policy allows to start. When an agent needs an answer or a permission, it asks a person in the session's thread and waits.

Each project chooses an autonomy policy:

${autonomyLevels.map((level) => `- **${level.name}**${level.isDefault ? " (default)" : ""}: ${level.body}`).join("\n")}

Code hosts (GitHub, GitLab, Bitbucket; cloud or self-managed) own every mirrored field. Lictory links branches, pull requests, issues and commits to work items, verifies webhooks and writes to the host only through explicit commands.

## Agents you can trust

${trustPrinciples.map((principle) => `- **${principle.title}.** ${principle.body}`).join("\n")}

Work in the UI, delegate to Litto, or connect your own agent through MCP. The same capabilities and server-side permissions apply across surfaces. Account security and credentials remain with the person.

## Lictory Spaces

Lictory Spaces keeps what a team knows (runbooks, architecture notes, handbooks) in spaces of nested pages. A space belongs to the organization, a project or a team: members of that home edit it and other organization members read it, or the space is Restricted to named people. Several people edit a page's live draft at once; the editor says "Saved" only once the server has stored every edit. Pages change through the same reviewed history as specifications: in a Direct space editors publish the draft as a new version, in a Reviewed space changes arrive as pull requests that merge only after the required reviewers approve the exact result. Published versions never change and can be compared word by word. Comments stay anchored to the text they quote, pages mention work items with their live status, and agents connected over MCP propose page changes as pull requests rather than typing into live drafts.

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

- [Source code on GitHub](${repositoryUrl}): the MIT-licensed repository, with releases, issues and the contribution guide.
- [Documentation](https://docs.lictory.com): how to use Lictory, self-host it and connect agents.
- [Try Lictory in 5 minutes](${tryUrl}): run it on your own computer with one command and Docker, for evaluation.
- [Installation guide](${installUrl}): install Lictory on your own Linux server.`;

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

- [Full product overview](${absoluteUrl("/llms-full.txt")}): how ${siteName} works, its modules, runners and autonomy levels, key concepts, comparison with a tool stack and with Jira and Linear, frequently asked questions and the full text of the comparisons, alternatives, roundups and guides.
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
