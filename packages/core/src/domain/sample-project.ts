import { and, eq, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  type Command,
  type ProjectSettings,
} from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import {
  applyMutation,
  directory,
  isAdmin,
  lock,
  type Actor,
  type MutationOutcome,
  type Tx,
} from "@lictory/core/domain/service";

// Lictory's sample project (docs/internals/onboarding.md#sample-project).
//
// A person evaluating Lictory alone cannot see the review workflow without
// colleagues. On request, an organization administrator gets one clearly
// labelled project with a specification in review: a few revisions, an
// anchored blocking discussion, a recorded decision, a pull request awaiting
// review, readiness checks that show what is missing and a Space page that
// references the item.
//
// Everything is created by ordinary domain commands, each through
// `applyMutation` (authorization, projections, activity and receipt), all in
// the caller's one transaction: the sample exists completely or not at all.
// The person who asked is the author of everything. No other people are
// invented and nothing is approved: reviews are requested, never decided, so
// the person makes every decision themselves.

const SAMPLE_KEY = "SAMPLE";

export type SampleProject = {
  projectId: string;
  projectKey: string;
  workItemId: string;
  workItemKey: string;
  spaceId: string;
  pageId: string;
  pullRequestId: string;
  deliveryMode: ProjectSettings["deliveryMode"];
};

const problem = `## Problem

Customers abandon checkout when a card payment fails for a temporary reason, such as a timeout at the payment provider. Support then asks them to pay again by hand.

## Desired outcome

A payment that fails for a temporary reason succeeds without the customer doing anything.`;

const behavior = `

## Behavior

When the payment provider reports a temporary failure, checkout retries the payment up to three times and waits longer before each attempt. Every retry reuses the original payment request.`;

const failure = `

## Failure behavior

After the third failed attempt the payment is marked failed and the customer sees “Your card could not be charged. No money was taken.”

## Acceptance criteria

- [ ] A retried payment never charges the customer twice.
- [ ] After the last failed attempt the payment is marked failed.
- [ ] A hard decline, such as insufficient funds, is never retried.`;

const timeouts = `

## Timeouts

If the provider does not answer within 10 seconds, the attempt counts as failed and the next retry starts. A late success of an earlier attempt is kept, and the attempts after it are cancelled.`;

const SECTION = "Behavior";
const QUOTE = "Every retry reuses the original payment request.";

// Page content in the editor's canonical JSON.
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Node = Record<string, Json>;
const text = (value: string): Node => ({ type: "text", text: value });
const paragraph = (id: string, ...content: Node[]): Node => ({
  type: "paragraph",
  attrs: { id },
  content,
});
const heading = (id: string, value: string): Node => ({
  type: "heading",
  attrs: { id, level: 2 },
  content: [text(value)],
});

export async function createSampleProject(
  tx: Tx,
  actor: Actor,
  input: { organizationId: string; fromProjectId?: string },
  onApplied?: (outcome: MutationOutcome) => void,
): Promise<SampleProject> {
  const { organizationId } = input;
  const { userId } = actor;
  await lock(tx, organizationId);
  const roster = await directory(tx, userId, organizationId);
  const membership = roster.organizations.find((o) => o.id === organizationId);
  if (!membership || !isAdmin(membership))
    throw new DomainError(
      "forbidden",
      "An organization administrator creates the sample project, because it is a new project.",
    );
  // The sample follows the delivery choices of the project it was opened
  // from, so it behaves like the person's own work (both delivery modes).
  const from = input.fromProjectId
    ? roster.projects.find(
        (p) => p.id === input.fromProjectId && !p.archivedAt && !p.sample,
      )
    : undefined;
  const taken = new Set(roster.projects.map((p) => p.key));
  const projectKey = [
    SAMPLE_KEY,
    ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `${SAMPLE_KEY}${n}`),
  ].find((key) => !taken.has(key));
  if (!projectKey)
    throw new DomainError(
      "conflict",
      "Every SAMPLE project key is in use. Rename a project key to create the sample project.",
    );

  const run = async (command: Command) =>
    (
      await applyMutation(
        tx,
        actor,
        {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId,
          command,
        },
        { applied: onApplied },
      )
    ).summary;
  const latestRevision = async (workItemId: string) =>
    (
      await tx
        .select({
          id: s.specificationRevision.id,
          number: s.specificationRevision.number,
        })
        .from(s.specificationRevision)
        .where(
          and(
            eq(s.specificationRevision.organizationId, organizationId),
            eq(s.specificationRevision.workItemId, workItemId),
          ),
        )
    ).sort((a, b) => b.number - a.number)[0]!.id;
  const branch = async (workItemId: string, name: string) =>
    (
      await tx
        .select({
          id: s.specificationBranch.id,
          headId: s.specificationBranch.headId,
        })
        .from(s.specificationBranch)
        .where(
          and(
            eq(s.specificationBranch.organizationId, organizationId),
            eq(s.specificationBranch.workItemId, workItemId),
            eq(s.specificationBranch.name, name),
            isNull(s.specificationBranch.deletedAt),
          ),
        )
    )[0]!;

  // The project, labelled as the sample. The domain refuses a second one.
  const projectId = crypto.randomUUID();
  await run({
    type: "createProject",
    projectId,
    name: "Sample project",
    key: projectKey,
    description:
      "A sample to explore how Lictory reviews a specification. You created everything in it; nobody else was added. Archive it when you are done.",
    sample: true,
  });
  if (from)
    await run({
      type: "updateProject",
      projectId,
      deliveryMode: from.deliveryMode,
      readinessPolicy: from.readinessPolicy,
    });
  const after = await directory(tx, userId, organizationId);
  const story =
    after.types.find(
      (t) => t.name === "Story" && t.hasSpecification && !t.archivedAt,
    ) ??
    after.types.find(
      (t) =>
        t.hasSpecification &&
        !t.archivedAt &&
        after.projectTypes.some(
          (x) => x.projectId === projectId && x.typeId === t.id,
        ),
    );
  if (!story)
    throw new DomainError(
      "conflict",
      "The sample needs a work item type with a specification. Restore one in Settings → Work item types.",
    );
  const product = after.disciplines.find(
    (d) =>
      d.projectId === projectId &&
      !d.archivedAt &&
      d.capabilities.review &&
      d.userIds.includes(userId),
  );

  // A specification with a few revisions: rough proposal, behavior, then
  // failure behavior and acceptance criteria.
  const workItemId = crypto.randomUUID();
  const title = "Retry failed card payments";
  await run({
    type: "createWorkItem",
    projectId,
    workItemId,
    typeId: story.id,
    parentId: null,
    title,
    description: problem,
  });
  await run({
    type: "updateSpecification",
    workItemId,
    baseRevisionId: await latestRevision(workItemId),
    title,
    content: problem + behavior,
    summary: "Describe the retry behavior",
  });
  await run({
    type: "updateSpecification",
    workItemId,
    baseRevisionId: await latestRevision(workItemId),
    title,
    content: problem + behavior + failure,
    summary: "Add failure behavior and acceptance criteria",
  });
  const revisionId = await latestRevision(workItemId);

  // An open blocking discussion anchored to the sentence it questions,
  // before anything that could make the item ready.
  await run({
    type: "createThread",
    workItemId,
    baseRevisionId: revisionId,
    threadId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
    body: "Does “the original payment request” include its idempotency key? If the provider timed out but did charge the card, a retry sent as a new request could charge the customer twice. Answer it here or in the specification, then resolve this discussion.",
    blocking: true,
    section: SECTION,
    quote: QUOTE,
  });
  // A conclusion worth keeping after the discussion is gone.
  const decisionId = crypto.randomUUID();
  const decisionTitle = "Hard declines are never retried";
  await run({
    type: "recordDecision",
    workItemId,
    baseRevisionId: revisionId,
    decisionId,
    title: decisionTitle,
    body: "A decline such as insufficient funds or a stolen card cannot succeed on retry, and repeated attempts look like card testing to the provider. Only timeouts and provider errors are retried.",
  });
  // Review is requested from the person's own discipline, which they can
  // decide themselves. Nobody approves anything here.
  if (product)
    await run({
      type: "requestReview",
      workItemId,
      baseRevisionId: revisionId,
      reviewId: crypto.randomUUID(),
      disciplineId: product.id,
      userId: null,
      required: true,
    });

  // A proposed change on a branch with a pull request awaiting review. It
  // copies the requested review; its author cannot approve their own change.
  const branchId = crypto.randomUUID();
  await run({
    type: "createBranch",
    workItemId,
    baseRevisionId: revisionId,
    branchId,
    name: "timeout-behavior",
  });
  await run({
    type: "commitBranch",
    workItemId,
    branchId,
    baseCommitId: (await branch(workItemId, "timeout-behavior")).headId,
    title,
    content: problem + behavior + timeouts + failure,
    message: "Define what happens when the provider times out",
  });
  const pullRequestId = crypto.randomUUID();
  await run({
    type: "createPullRequest",
    workItemId,
    pullRequestId,
    sourceId: branchId,
    targetId: (await branch(workItemId, "main")).id,
    title: "Define what happens when the provider times out",
    description:
      "Adds the timeout rule the retries depend on. A pull request is approved by someone other than its author: invite a teammate to review it.",
    draft: false,
  });

  // Knowledge that goes with the work: a Space page referencing the item
  // and the decision.
  const spaces = await tx
    .select({ slug: s.space.slug })
    .from(s.space)
    .where(
      and(
        eq(s.space.organizationId, organizationId),
        isNull(s.space.archivedAt),
      ),
    );
  const slugs = new Set(spaces.map((x) => x.slug.toLowerCase()));
  const slug =
    ["sample", ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => `sample-${n}`)].find(
      (x) => !slugs.has(x),
    ) ?? `sample-${projectId.slice(0, 8)}`;
  const spaceId = crypto.randomUUID();
  await run({
    type: "createSpace",
    spaceId,
    name: "Sample handbook",
    slug,
    icon: "🧪",
    description: "Knowledge pages that go with the sample project.",
    home: { projectId },
  });
  const pageId = crypto.randomUUID();
  const workItemKey = `${projectKey}-1`;
  await run({
    type: "createPage",
    spaceId,
    pageId,
    title: "How checkout retries work",
    content: {
      type: "doc",
      content: [
        paragraph(
          "sample-intro",
          text(
            "Checkout retries a card payment that fails for a temporary reason, so the customer does not have to pay again by hand. The behavior is being agreed in ",
          ),
          { type: "workItemRef", attrs: { workItemId, key: workItemKey } },
          text("."),
        ),
        heading("sample-h-decisions", "Decisions"),
        paragraph("sample-decision", {
          type: "decisionRef",
          attrs: { decisionId, label: decisionTitle },
        }),
        heading("sample-h-try", "Try it"),
        paragraph(
          "sample-try",
          text(
            "Open the specification, resolve its blocking discussion and watch its readiness checks update. Then approve the Product review: the specification becomes ready.",
          ),
        ),
      ],
    },
  });

  return {
    projectId,
    projectKey,
    workItemId,
    workItemKey,
    spaceId,
    pageId,
    pullRequestId,
    deliveryMode: from?.deliveryMode ?? "native",
  };
}

// Archives the sample project and the spaces homed in it. Reversible:
// both are restored with the ordinary archive commands.
export async function archiveSampleProject(
  tx: Tx,
  actor: Actor,
  input: { organizationId: string },
  onApplied?: (outcome: MutationOutcome) => void,
) {
  const { organizationId } = input;
  await lock(tx, organizationId);
  const roster = await directory(tx, actor.userId, organizationId);
  const project = roster.projects.find((p) => p.sample && !p.archivedAt);
  if (!project)
    throw new DomainError(
      "not_found",
      "This organization has no active sample project.",
    );
  const run = (command: Command) =>
    applyMutation(
      tx,
      actor,
      { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command },
      { applied: onApplied },
    );
  const spaces = await tx
    .select({ id: s.space.id })
    .from(s.space)
    .where(
      and(
        eq(s.space.organizationId, organizationId),
        eq(s.space.projectId, project.id),
        isNull(s.space.archivedAt),
      ),
    );
  for (const space of spaces)
    await run({ type: "archiveSpace", spaceId: space.id, archived: true });
  await run({ type: "archiveProject", projectId: project.id, archived: true });
  return { projectId: project.id, archivedSpaces: spaces.length };
}
