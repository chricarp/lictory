import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionEntity } from "@lictory/core/factory/entities";
import { speakable } from "@lictory/platform/components/shell/announcer";
import { messageAnnouncement } from "@lictory/platform/components/channels/announce";
import type { MessageRow } from "@lictory/platform/components/channels/data";
import { sessionAnnouncements } from "@lictory/platform/components/factory/announce";
import { carriedApprovalReason } from "@lictory/core/contracts/decomposition";
import { reviewAnnouncements } from "@lictory/platform/components/review/announce";
import {
  pullRequestAnnouncements,
  type PullRequestSnapshot,
} from "@lictory/platform/components/code/announce";
import { fieldError } from "@lictory/platform/components/auth/form-field";

// What the workspace's live region says when others change what a person
// is looking at (docs/internals/accessibility.md, "Announcements"): news
// from others is said once, in words; the person's own acts are not.

const message = (patch: Partial<MessageRow>): MessageRow => ({
  id: "m1",
  channelId: "c1",
  sequence: 1,
  threadRootId: null,
  authorKind: "user",
  authorUserId: "other",
  authorAgentId: null,
  onBehalfOfUserId: null,
  via: null,
  kind: "message",
  body: "Tests **pass**, see [the run](https://ci.example/1)",
  payload: null,
  attachments: [],
  replyCount: 0,
  lastReplyAt: null,
  replyAuthors: [],
  editedAt: null,
  deletedAt: null,
  externalSource: null,
  createdAt: 0,
  ...patch,
});

void test("a message from someone else is announced with who said it, in plain words", () => {
  assert.equal(
    messageAnnouncement(message({}), "me", () => "Ada"),
    "Ada: Tests pass, see the run",
  );
  assert.equal(
    messageAnnouncement(
      message({
        body: "",
        attachments: [
          { id: "f", filename: "a.png", mimeType: "image/png", size: 1 },
        ],
      }),
      "me",
      () => "Ada",
    ),
    "Ada: shared a file",
  );
});

void test("my own messages, cards, system lines and deleted messages are not announced", () => {
  const name = () => "Someone";
  assert.equal(
    messageAnnouncement(message({ authorUserId: "me" }), "me", name),
    null,
  );
  assert.equal(
    messageAnnouncement(message({ kind: "card" }), "me", name),
    null,
  );
  assert.equal(
    messageAnnouncement(message({ kind: "system" }), "me", name),
    null,
  );
  assert.equal(
    messageAnnouncement(message({ deletedAt: 1 }), "me", name),
    null,
  );
});

void test("speakable keeps words and drops markup and code", () => {
  assert.equal(
    speakable("# Plan\n\n- `retry` with **care**\n\n```ts\nx()\n```"),
    "Plan - retry with care (code)",
  );
});

type Session = Pick<
  SessionEntity,
  "id" | "status" | "attempts" | "eventCount" | "approvals"
>;
const session = (patch: Partial<Session>): Session => ({
  id: "s1",
  status: "running",
  attempts: 1,
  eventCount: 3,
  approvals: [],
  ...patch,
});
const approval = {
  id: "a1",
  requestKey: "k",
  title: "Run the migration on staging",
  detail: { tool: "Bash", input: { command: "bun run db:migrate" } },
  status: "pending",
  decidedById: null,
  note: null,
  createdAt: "2026-11-25T10:00:00.000Z",
  decidedAt: null,
} as unknown as SessionEntity["approvals"][number];

void test("an agent's approval request is announced once, keyed by the request", () => {
  const said = sessionAnnouncements(
    session({}),
    session({ status: "waiting", approvals: [approval] }),
    "Forge",
    "Refund button",
  );
  assert.deepEqual(said, [
    {
      key: "approval:a1",
      text: "Forge asks for approval: Run the migration on staging",
    },
  ]);
  // A request naming no action is a question, and is announced as one.
  const asked = sessionAnnouncements(
    session({}),
    session({
      status: "waiting",
      approvals: [{ ...approval, id: "a2", detail: { tool: null } }],
    }),
    "Forge",
    "Refund button",
  );
  assert.deepEqual(asked, [
    { key: "approval:a2", text: "Forge asks: Run the migration on staging" },
  ]);
});

void test("finishing and failing are announced; resuming after an answer is not", () => {
  assert.deepEqual(
    sessionAnnouncements(
      session({}),
      session({ status: "failed" }),
      "Forge",
      "Refund button",
      "tests did not pass",
    ).map((s) => s.text),
    ["Forge failed Refund button: tests did not pass"],
  );
  assert.deepEqual(
    sessionAnnouncements(
      session({}),
      session({ status: "completed" }),
      "Forge",
      "Refund button",
    ).map((s) => s.text),
    ["Forge finished Refund button"],
  );
  assert.deepEqual(
    sessionAnnouncements(
      session({ status: "waiting", approvals: [approval] }),
      session({ status: "running" }),
      "Forge",
      "Refund button",
    ),
    [],
  );
});

const reviewState = (
  revision: { id: string; number: number; authorId: string },
  approvals: [
    string,
    { status: string; reviewerId: string; endReason?: string },
  ][],
) => ({
  revision,
  approvals: new Map(
    approvals.map(([id, a]) => [id, { ...a, reviewId: "r1" }] as const),
  ),
});
const names = {
  member: (id: string | null | undefined) => (id === "bo" ? "Bo" : "Ada"),
  responsibility: () => "Engineering review",
};

void test("another reviewer's approval and a new revision by someone else are announced", () => {
  const r1 = { id: "v1", number: 1, authorId: "ada" };
  const r2 = { id: "v2", number: 2, authorId: "ada" };
  assert.deepEqual(
    reviewAnnouncements(
      reviewState(r1, []),
      reviewState(r1, [["p1", { status: "granted", reviewerId: "bo" }]]),
      "me",
      names,
    ).map((s) => s.text),
    ["Bo approved Engineering review on revision 1"],
  );
  assert.deepEqual(
    reviewAnnouncements(
      reviewState(r1, [["p1", { status: "granted", reviewerId: "bo" }]]),
      reviewState(r2, [["p1", { status: "stale", reviewerId: "bo" }]]),
      "me",
      names,
    ).map((s) => s.text),
    ["Ada saved revision 2", "Approvals need review again: Engineering review"],
  );
});

void test("my own approval and my own revision are not announced, but approvals my revision outdated are", () => {
  const r1 = { id: "v1", number: 1, authorId: "me" };
  const r2 = { id: "v2", number: 2, authorId: "me" };
  assert.deepEqual(
    reviewAnnouncements(
      reviewState(r1, []),
      reviewState(r1, [["p1", { status: "granted", reviewerId: "me" }]]),
      "me",
      names,
    ),
    [],
  );
  // The save itself is not news to me; what it did to others' approvals is.
  assert.deepEqual(
    reviewAnnouncements(
      reviewState(r1, [["p1", { status: "granted", reviewerId: "bo" }]]),
      reviewState(r2, [["p1", { status: "stale", reviewerId: "bo" }]]),
      "me",
      names,
    ).map((s) => s.text),
    [
      "Revision 2 outdated earlier approvals: Engineering review needs review again",
    ],
  );
});

void test("a revision that keeps the text says the approvals carried over, never outdated", () => {
  const r4 = { id: "v4", number: 4, authorId: "me" };
  const r5 = { id: "v5", number: 5, authorId: "me" };
  const before = reviewState(r4, [
    ["p1", { status: "granted", reviewerId: "bo" }],
  ]);
  const after = reviewState(r5, [
    [
      "p1",
      {
        status: "stale",
        reviewerId: "bo",
        endReason: carriedApprovalReason(5),
      },
    ],
    // The carried decision is a new row on revision 5, not a new approval.
    ["p2", { status: "granted", reviewerId: "bo" }],
  ]);
  assert.deepEqual(
    reviewAnnouncements(before, after, "me", names).map((s) => s.text),
    [
      "Revision 5 kept the approvals: Engineering review. The specification text did not change.",
    ],
  );
  assert.deepEqual(
    reviewAnnouncements(
      before,
      { ...after, revision: { ...r5, authorId: "ada" } },
      "me",
      names,
    ).map((s) => s.text),
    ["Ada saved revision 5"],
  );
});

const pr = (patch: Partial<PullRequestSnapshot>): PullRequestSnapshot => ({
  id: "pr1",
  name: "pull request #12",
  state: "open",
  checks: "pending",
  failing: [],
  head: "abc",
  mergedBy: null,
  mergedByMe: false,
  ...patch,
});

void test("check results and a merge by a policy are announced", () => {
  assert.deepEqual(
    pullRequestAnnouncements(
      pr({}),
      pr({ checks: "failure", failing: ["ci"] }),
    ).map((s) => s.text),
    ["Checks failed on pull request #12: ci"],
  );
  assert.deepEqual(
    pullRequestAnnouncements(
      pr({ checks: "success" }),
      pr({
        checks: "success",
        state: "merged",
        mergedBy: "by Autopilot · policy set by Ada",
      }),
    ).map((s) => s.text),
    ["Pull request #12 merged by Autopilot · policy set by Ada"],
  );
});

void test("a merge I asked for is not announced, and a new head's result is new", () => {
  assert.deepEqual(
    pullRequestAnnouncements(pr({}), pr({ state: "merged", mergedByMe: true })),
    [],
  );
  const [first] = pullRequestAnnouncements(pr({}), pr({ checks: "success" }));
  const [second] = pullRequestAnnouncements(
    pr({ head: "def" }),
    pr({ head: "def", checks: "success" }),
  );
  assert.notEqual(first!.key, second!.key);
});

void test("field errors name the field and what to do", () => {
  const field = (
    validity: Partial<ValidityState>,
    extra: Partial<{ type: string; minLength: number; title: string }> = {},
  ) => ({
    validity: { valid: false, ...validity } as ValidityState,
    validationMessage: "Invalid",
    minLength: extra.minLength ?? -1,
    title: extra.title ?? "",
    type: extra.type ?? "text",
    labels: [{ textContent: "Full name" }],
  });
  assert.equal(
    fieldError(field({ valueMissing: true })),
    "Full name is required.",
  );
  assert.equal(
    fieldError(field({ typeMismatch: true }, { type: "email" })),
    "Enter an email address like name@company.com.",
  );
  assert.equal(
    fieldError(field({ tooShort: true }, { minLength: 10 })),
    "Full name needs at least 10 characters.",
  );
  assert.equal(
    fieldError({ ...field({}), validity: { valid: true } as ValidityState }),
    null,
  );
});
