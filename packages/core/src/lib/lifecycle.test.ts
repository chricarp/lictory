import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deliveryCategory,
  externalLinksByItem,
  lifecycleStage,
  refinementQueueStage,
  nextRefinementAction,
  readyForSelection,
  type ExternalLink,
} from "@lictory/core/lib/lifecycle";
import { deliveryIndex } from "@lictory/core/lib/work-items";
import type {
  RefinementState,
  StatusCategory,
} from "@lictory/core/contracts/protocol";

const delivery = deliveryIndex({
  types: [],
  teams: [],
  iterations: [],
  projectTypes: [],
  statuses: (
    ["backlog", "unstarted", "started", "done", "canceled"] as StatusCategory[]
  ).map((category, position) => ({
    id: category,
    projectId: "project",
    name: category,
    color: "gray",
    category,
    position,
    archivedAt: null,
  })),
});
const native = { deliveryMode: "native" as const };
const external = { deliveryMode: "external" as const };
const ready = {
  statusId: "backlog",
  refinementState: "ready" as RefinementState,
  archivedAt: null,
  committedRevisionId: null,
};
const link: ExternalLink = {
  type: "externalLink",
  id: "link",
  organizationId: "org",
  projectId: "project",
  workItemId: "item",
  connectionId: "jira",
  externalKey: "PAY-1",
  externalUrl: null,
  externalStatus: "To do",
  externalStatusCategory: "todo",
  externalAssignee: null,
  status: "synced",
  publishedRevisionId: "revision",
  publishedRevisionNumber: 1,
  lastError: null,
  syncedAt: "2026-10-30T00:00:00Z",
};

void test("ready means available before commitment, including tentative Todo", () => {
  assert.equal(readyForSelection(ready, native, delivery), true);
  assert.equal(
    readyForSelection({ ...ready, statusId: "unstarted" }, native, delivery),
    true,
  );
  assert.equal(
    readyForSelection(
      { ...ready, committedRevisionId: "accepted" },
      native,
      delivery,
    ),
    false,
  );
  assert.equal(
    lifecycleStage(
      { ...ready, committedRevisionId: "accepted" },
      native,
      delivery,
    ),
    "committed",
  );
  for (const statusId of ["started", "done", "canceled"])
    assert.equal(
      readyForSelection({ ...ready, statusId }, native, delivery),
      false,
    );
  assert.equal(
    readyForSelection({ ...ready, archivedAt: "2026-10-30" }, native, delivery),
    false,
  );
});

void test("external delivery ignores obsolete local statuses and leaves selection after handoff", () => {
  assert.equal(
    readyForSelection({ ...ready, statusId: "done" }, external, delivery),
    true,
  );
  assert.equal(readyForSelection(ready, external, delivery, link), false);
  assert.equal(lifecycleStage(ready, external, delivery, link), "committed");
  assert.equal(
    lifecycleStage(ready, external, delivery, {
      ...link,
      externalStatusCategory: "in_progress",
    }),
    "underway",
  );
  assert.equal(
    lifecycleStage(ready, external, delivery, {
      ...link,
      externalStatusCategory: "done",
    }),
    "completed",
  );
  assert.equal(deliveryCategory(ready, external, delivery), undefined);
  assert.equal(
    readyForSelection(ready, external, delivery, {
      ...link,
      externalKey: null,
      status: "pending",
    }),
    false,
  );
  assert.equal(
    readyForSelection(ready, external, delivery, {
      ...link,
      externalKey: null,
      status: "failed",
    }),
    true,
  );
});

void test("unready committed work keeps its delivery stage", () => {
  assert.equal(
    lifecycleStage(
      {
        ...ready,
        refinementState: "in_review",
        committedRevisionId: "accepted",
      },
      native,
      delivery,
    ),
    "committed",
  );
  assert.equal(
    lifecycleStage(
      { ...ready, statusId: "started", refinementState: "in_review" },
      native,
      delivery,
    ),
    "underway",
  );
  assert.equal(
    lifecycleStage(
      { ...ready, statusId: "done", refinementState: "draft" },
      native,
      delivery,
    ),
    "completed",
  );
  assert.equal(
    lifecycleStage({ ...ready, refinementState: "draft" }, native, delivery),
    "proposal",
  );
  assert.equal(
    lifecycleStage(
      { ...ready, refinementState: "refinement" },
      native,
      delivery,
    ),
    "refinement",
  );
  assert.equal(
    lifecycleStage(
      { ...ready, refinementState: "in_review" },
      native,
      delivery,
    ),
    "review",
  );
});

void test("the current delivery connection takes precedence over older links", () => {
  const old = {
    ...link,
    id: "old",
    connectionId: "old-jira",
    externalStatusCategory: "done" as const,
  };
  const targets = [
    {
      id: "target",
      projectId: "project",
      connectionId: "jira",
      externalProjectId: "100",
      externalProjectKey: "PAY",
      typeMapping: {},
    },
  ];
  for (const entities of [
    [old, link],
    [link, old],
  ])
    assert.equal(
      externalLinksByItem(entities, targets).get("item")?.id,
      "link",
    );
});

void test("next concern names the required responsibility and prioritizes blockers", () => {
  const item = {
    refinementState: "in_review" as const,
    blockingThreads: 0,
    readinessPassed: 2,
    readinessTotal: 4,
    reviews: [
      {
        id: "qa",
        responsibility: "QA",
        status: "requested",
        required: true,
        assigneeIds: [],
        approved: false,
      },
    ],
  };
  assert.match(nextRefinementAction(item), /Waiting on QA/);
  assert.match(
    nextRefinementAction({ ...item, blockingThreads: 1 }),
    /Resolve 1 blocking discussion/,
  );
  assert.match(
    nextRefinementAction({
      ...item,
      reviews: [{ ...item.reviews[0]!, status: "changes_requested" }],
    }),
    /Address changes requested by QA/,
  );
});

void test("later amendments stay in refinement while the accepted revision remains delivered", () => {
  const delivered = {
    ...ready,
    statusId: "done",
    committedRevisionId: "accepted",
    revisionId: "accepted",
    revisionNumber: 1,
  };
  assert.equal(refinementQueueStage(delivered, native, delivery), undefined);
  const amendment = {
    ...delivered,
    revisionId: "amendment",
    revisionNumber: 2,
    refinementState: "in_review" as const,
  };
  assert.equal(refinementQueueStage(amendment, native, delivery), "review");
  assert.equal(lifecycleStage(amendment, native, delivery), "completed");
  assert.equal(
    refinementQueueStage(
      { ...amendment, archivedAt: "2026-10-31" },
      native,
      delivery,
    ),
    undefined,
  );
  const externalAmendment = { ...amendment, committedRevisionId: null };
  assert.equal(
    refinementQueueStage(externalAmendment, external, delivery, {
      ...link,
      externalStatusCategory: "done",
    }),
    "review",
  );
  assert.equal(
    refinementQueueStage(
      { ...externalAmendment, refinementState: "ready" },
      external,
      delivery,
      link,
    ),
    "ready",
  );
  assert.equal(
    refinementQueueStage(
      { ...delivered, refinementState: null },
      native,
      delivery,
    ),
    undefined,
  );
});
