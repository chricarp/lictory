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
} from "@lictory/core/contracts/readiness";

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
  intelligenceReview: null,
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
  // The editor escapes a numbered heading ("## 1\. Plan"); it still names
  // the section people and agents call "1. Plan", and the reverse.
  assert.equal(
    sectionContent("## 1\\. Plan\n\nShip it.", "1. Plan"),
    "\nShip it.",
  );
  assert.equal(
    sectionContent("## 2) Plan\n\nShip it.", "2\\) Plan"),
    "\nShip it.",
  );
  assert.equal(sectionContent("## C:\\\\temp\n\nPath.", "C:\\temp"), "\nPath.");
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

void test("a Lictory Intelligence check is evidence about the current revision, never an approval", () => {
  const checks: ReadinessCheckDefinition[] = [
    { id: "ai", kind: "intelligence_review", severity: "blocker" },
  ];
  const review = {
    runId: "run1",
    revisionId: "r2",
    severities: ["minor", "major"],
    score: 87,
    model: "model-x",
    completedAt: "2026-01-01T00:00:00.000Z",
  };
  const run = (overrides: Partial<ReadinessEvidence>, definitions = checks) =>
    evaluateReadiness(definitions, evidence(overrides))[0]!;

  const none = run({});
  assert.equal(
    none.label,
    "Lictory Intelligence found no blocker in the current revision",
  );
  assert.equal(none.passed, false);
  assert.equal(
    none.detail,
    "Ask Lictory Intelligence to review revision 2, or override this check.",
  );

  // Blockers only: minor and major findings do not fail it.
  const clean = run({ intelligenceReview: review });
  assert.equal(clean.passed, true);
  assert.deepEqual(clean.intelligence, {
    runId: "run1",
    reviewedCurrent: true,
    findings: 0,
    score: 87,
    model: "model-x",
    completedAt: "2026-01-01T00:00:00.000Z",
    overridden: false,
  });
  // Stricter checks also fail on major findings.
  const strict = run({ intelligenceReview: review }, [
    { id: "ai", kind: "intelligence_review", severity: "major" },
  ]);
  assert.equal(strict.passed, false);
  assert.equal(
    strict.detail,
    "Lictory Intelligence found 1 blocker or major finding in revision 2. Address it and review again, or override this check.",
  );

  // A review of an earlier revision is not evidence for this one.
  const earlier = run({ intelligenceReview: { ...review, revisionId: "r1" } });
  assert.equal(earlier.passed, false);
  assert.equal(earlier.intelligence?.reviewedCurrent, false);
  assert.equal(earlier.intelligence?.score, null);

  // A person's override passes it for one revision and stays visible.
  const blocked = { ...review, severities: ["blocker", "blocker"] };
  const override = {
    checkId: "ai",
    userId: "u1",
    revisionId: "r2",
    revisionNumber: 2,
    createdAt: "2026-01-02T00:00:00.000Z",
  };
  assert.equal(
    run({ intelligenceReview: blocked }).detail,
    "Lictory Intelligence found 2 blockers in revision 2. Address them and review again, or override this check.",
  );
  const overridden = run({
    intelligenceReview: blocked,
    signOffs: new Map([["ai", override]]),
  });
  assert.equal(overridden.passed, true);
  assert.equal(overridden.intelligence?.overridden, true);
  assert.equal(overridden.signOff?.signedOffBy, "u1");
  const old = run({
    intelligenceReview: blocked,
    signOffs: new Map([["ai", { ...override, revisionId: "r1" }]]),
  });
  assert.equal(old.passed, false);
});

void test("a Lictory Intelligence check needs a person's decision beside it", () => {
  const ai: ReadinessCheckDefinition = {
    id: "ai",
    kind: "intelligence_review",
    severity: "blocker",
  };
  const only = readinessChecksSchema.safeParse([
    { id: "specification", kind: "specification" },
    ai,
  ]);
  assert.equal(only.success, false);
  assert.ok(
    readinessChecksSchema.safeParse([...defaultReadinessChecks, ai]).success,
  );
  assert.equal(
    readinessChecksSchema.safeParse([
      ...defaultReadinessChecks,
      ai,
      { ...ai, id: "ai2" },
    ]).success,
    false,
  );
});
