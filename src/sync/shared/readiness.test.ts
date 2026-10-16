import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checksFor,
  defaultReadinessChecks,
  diffReadinessChecks,
  evaluateReadiness,
  readinessChecksSchema,
  sameReadinessRules,
  sectionContent,
  type ReadinessCheckDefinition,
  type ReadinessEvidence,
} from "./readiness";

const evidence = (
  overrides: Partial<ReadinessEvidence> = {},
): ReadinessEvidence => ({
  content: "# Intent\n\nRetries.",
  revisionId: "r2",
  revisionNumber: 2,
  blockingThreads: 0,
  requiredResponsibilities: ["Engineering"],
  missingResponsibilities: [],
  approvedResponsibilities: ["Engineering"],
  disciplineNames: new Map([
    ["eng", "Engineering"],
    ["qa", "QA"],
  ]),
  childSpecifications: 0,
  childSpecificationsNotReady: 0,
  signOffs: new Map(),
  ...overrides,
});

void test("the defaults keep the previous evidence and no longer look for acceptance criteria", () => {
  const checks = evaluateReadiness(defaultReadinessChecks, evidence());
  assert.deepEqual(
    checks.map((c) => [c.key, c.label]),
    [
      ["specification", "The specification is not empty"],
      ["no_blocking_threads", "No blocking discussion is open"],
      ["reviews_requested", "At least one required review is requested"],
      [
        "reviews_approved",
        "Every required review approved the current revision",
      ],
    ],
  );
  assert.ok(checks.every((c) => c.passed));
  // Passing checks carry no detail, so projections stay JSON-stable.
  assert.ok(checks.every((c) => !("detail" in c)));
  const failing = evaluateReadiness(
    defaultReadinessChecks,
    evidence({
      blockingThreads: 2,
      childSpecifications: 2,
      childSpecificationsNotReady: 1,
      missingResponsibilities: ["Engineering"],
    }),
  );
  assert.deepEqual(
    failing.filter((c) => !c.passed).map((c) => c.detail),
    [
      "2 blocking discussions open.",
      "Waiting on Engineering for revision 2.",
      "1 of 2 child specifications is not ready.",
    ],
  );
});

void test("a required section passes only when it has content", () => {
  const section: ReadinessCheckDefinition[] = [
    { id: "ac", kind: "section", heading: "Acceptance criteria" },
  ];
  const run = (content: string) =>
    evaluateReadiness(section, evidence({ content }))[0]!;
  assert.equal(
    run("# Intent").label,
    "It has a non-empty “Acceptance criteria” section",
  );
  assert.equal(run("# Intent\n\nNo criteria.").passed, false);
  assert.equal(run("# Intent").detail, "Add a “Acceptance criteria” section.");
  assert.equal(
    run("## Acceptance criteria\n\n<!-- todo -->\n\n## Notes\n\nLater.").detail,
    "The “Acceptance criteria” section is empty.",
  );
  assert.equal(
    run("## **Acceptance Criteria:**\n\n- [ ] No duplicate charge").passed,
    true,
  );
  // Deeper headings belong to the section; a heading in code is text.
  assert.equal(
    sectionContent(
      "## Acceptance criteria\n### Happy path\nOk\n```\n## Not a heading\n```\n## Next\nOut",
      "acceptance criteria",
    ),
    "### Happy path\nOk\n```\n## Not a heading\n```",
  );
});

void test("discipline approvals and manual sign-offs", () => {
  const checks: ReadinessCheckDefinition[] = [
    { id: "qa", kind: "discipline_approval", disciplineIds: ["qa", "eng"] },
    {
      id: "design",
      kind: "manual",
      label: "Designs attached",
      description: "Link the final designs.",
      disciplineIds: ["eng"],
    },
  ];
  const before = evaluateReadiness(checks, evidence());
  assert.deepEqual(
    before.map((c) => [c.label, c.passed, c.detail]),
    [
      [
        "QA and Engineering approved the current revision",
        false,
        "Waiting on QA to approve revision 2.",
      ],
      ["Designs attached", false, "Link the final designs."],
    ],
  );
  assert.deepEqual(before[1]!.signOff, {
    disciplineIds: ["eng"],
    signedOffBy: null,
    signedOffAt: null,
  });
  const signOff = {
    checkId: "design",
    userId: "u1",
    revisionId: "r1",
    revisionNumber: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  // A sign-off applies to the revision it was given on.
  const stale = evaluateReadiness(
    checks,
    evidence({ signOffs: new Map([["design", signOff]]) }),
  );
  assert.equal(
    stale[1]!.detail,
    "Signed off on revision 1. Sign off again for revision 2.",
  );
  const after = evaluateReadiness(
    checks,
    evidence({
      approvedResponsibilities: ["engineering", "QA"],
      signOffs: new Map([["design", { ...signOff, revisionId: "r2" }]]),
    }),
  );
  assert.ok(after.every((c) => c.passed));
  assert.equal(after[1]!.signOff?.signedOffBy, "u1");
});

void test("rules are per type, compared by content and diffed by check", () => {
  assert.equal(checksFor({}, "story"), defaultReadinessChecks);
  assert.equal(
    readinessChecksSchema.safeParse([
      defaultReadinessChecks[0],
      { ...defaultReadinessChecks[0]!, id: "again" },
    ]).success,
    false,
  );
  assert.equal(readinessChecksSchema.safeParse([]).success, false);
  // A type spelled out with the defaults is the same as one left out.
  assert.ok(
    sameReadinessRules(
      {
        story: JSON.parse(
          JSON.stringify(defaultReadinessChecks),
        ) as ReadinessCheckDefinition[],
      },
      {},
    ),
  );
  const section: ReadinessCheckDefinition = {
    id: "ac",
    kind: "section",
    heading: "Acceptance criteria",
  };
  const story = [...defaultReadinessChecks.slice(1), section];
  assert.ok(!sameReadinessRules({ story }, {}));
  assert.deepEqual(
    diffReadinessChecks(defaultReadinessChecks, story).map((c) => [
      c.check.id,
      c.change,
    ]),
    [
      ["ac", "added"],
      ["specification", "removed"],
    ],
  );
  assert.deepEqual(
    diffReadinessChecks(story, [
      ...story.slice(0, -1),
      { ...section, heading: "Failure behavior" },
    ]).map((c) => c.change),
    ["changed"],
  );
});
