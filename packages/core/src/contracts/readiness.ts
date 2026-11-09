import { z } from "zod";

// A project's Definition of Ready: for each work item type with a
// specification, the checks that must pass before an item is ready. It is
// versioned: every publication is an immutable version. Types the project has
// not configured use Lictory's defaults.

const id = z.string().min(1).max(160);
const builtInKinds = [
  "specification",
  "no_blocking_threads",
  "reviews_requested",
  "reviews_approved",
  "children_ready",
] as const;
export const readinessCheckKinds = [
  ...builtInKinds,
  "section",
  "discipline_approval",
  "intelligence_review",
  "manual",
] as const;
export type ReadinessCheckKind = (typeof readinessCheckKinds)[number];
export type BuiltInReadinessKind = (typeof builtInKinds)[number];
export function isBuiltInKind(
  kind: ReadinessCheckKind,
): kind is BuiltInReadinessKind {
  return (builtInKinds as readonly string[]).includes(kind);
}

// The finding severities an intelligence check can fail on: blockers only, or
// blockers and major findings.
export const intelligenceCheckSeverities = ["blocker", "major"] as const;
export type IntelligenceCheckSeverity =
  (typeof intelligenceCheckSeverities)[number];

// Checks only a person's decision can pass.
const humanDecisionKinds: ReadinessCheckKind[] = [
  "reviews_approved",
  "discipline_approval",
  "manual",
];

// Stable across versions, so manual sign-offs survive edits of a check.
const checkId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Check ids use letters, digits, - and _.");
export const readinessCheckDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({ id: checkId, kind: z.enum(builtInKinds) }),
  z.object({
    id: checkId,
    kind: z.literal("section"),
    heading: z.string().trim().min(1, "Name every required section.").max(120),
  }),
  z.object({
    id: checkId,
    kind: z.literal("discipline_approval"),
    disciplineIds: z.array(id).min(1, "Choose who must approve.").max(20),
  }),
  // An automated check, never an approval: Lictory Intelligence reviewed the
  // current revision and found nothing at or above `severity` about the item.
  // A person can override it for one revision; nothing else makes it pass.
  z.object({
    id: checkId,
    kind: z.literal("intelligence_review"),
    severity: z.enum(intelligenceCheckSeverities),
  }),
  z.object({
    id: checkId,
    kind: z.literal("manual"),
    label: z.string().trim().min(1, "Name every sign-off.").max(120),
    description: z.string().trim().max(500).nullable(),
    // Who may sign off; empty means any member holding a discipline.
    disciplineIds: z.array(id).max(20),
  }),
]);
export type ReadinessCheckDefinition = z.infer<
  typeof readinessCheckDefinitionSchema
>;

export const readinessChecksSchema = z
  .array(readinessCheckDefinitionSchema)
  .min(1, "Keep at least one check for every type.")
  .max(30, "A type can require at most 30 checks.")
  .superRefine((checks, ctx) => {
    const ids = new Set<string>();
    const kinds = new Set<string>();
    let intelligence = 0;
    for (const check of checks) {
      if (ids.has(check.id))
        ctx.addIssue({ code: "custom", message: "Check ids must be unique." });
      ids.add(check.id);
      if (check.kind === "intelligence_review" && ++intelligence === 2)
        ctx.addIssue({
          code: "custom",
          message: "A type can require the Lictory Intelligence check once.",
        });
      if (isBuiltInKind(check.kind)) {
        if (kinds.has(check.kind))
          ctx.addIssue({
            code: "custom",
            message: "Each built-in check can only be required once.",
          });
        kinds.add(check.kind);
      }
    }
    // An automated check adds evidence to people's decisions; it can never be
    // the only thing between a specification and Ready.
    if (
      intelligence > 0 &&
      !checks.some((c) => humanDecisionKinds.includes(c.kind))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "The Lictory Intelligence check needs a person’s decision beside it: also require approvals or a sign-off.",
      });
  });
// Checks per work item type id. A type without an entry uses the defaults.
export const readinessRulesSchema = z
  .record(id, readinessChecksSchema)
  .refine((rules) => Object.keys(rules).length <= 20, "Too many types.");
export type ReadinessRules = Record<string, ReadinessCheckDefinition[]>;

// What every type requires until a project's administrators change it.
export const defaultReadinessChecks: ReadinessCheckDefinition[] = [
  { id: "specification", kind: "specification" },
  { id: "no_blocking_threads", kind: "no_blocking_threads" },
  { id: "reviews_requested", kind: "reviews_requested" },
  { id: "reviews_approved", kind: "reviews_approved" },
  { id: "children_ready", kind: "children_ready" },
];

export function checksFor(rules: ReadinessRules, typeId: string) {
  return rules[typeId] ?? defaultReadinessChecks;
}

// A recipe for a common Definition of Ready: the specification has acceptance
// criteria and a chosen discipline (QA) signs them off. The sign-off belongs
// to the revision it was given on, so a new revision needs a new one. Adds
// only what is missing and keeps every other check.
export const acceptanceCriteriaHeading = "Acceptance criteria";
export const acceptanceSignOffLabel =
  "Acceptance criteria are complete and testable";
export function hasAcceptanceSignOff(
  checks: ReadinessCheckDefinition[],
  disciplineId: string,
) {
  const wanted = normalizeHeading(acceptanceCriteriaHeading);
  return {
    section: checks.some(
      (c) => c.kind === "section" && normalizeHeading(c.heading) === wanted,
    ),
    signOff: checks.some(
      (c) =>
        c.kind === "manual" &&
        c.disciplineIds.length === 1 &&
        c.disciplineIds[0] === disciplineId,
    ),
  };
}
export function withAcceptanceSignOff(
  checks: ReadinessCheckDefinition[],
  disciplineId: string,
  newId: () => string = () => crypto.randomUUID(),
): ReadinessCheckDefinition[] {
  const has = hasAcceptanceSignOff(checks, disciplineId);
  return [
    ...checks,
    ...(has.section
      ? []
      : [
          {
            id: newId(),
            kind: "section" as const,
            heading: acceptanceCriteriaHeading,
          },
        ]),
    ...(has.signOff
      ? []
      : [
          {
            id: newId(),
            kind: "manual" as const,
            label: acceptanceSignOffLabel,
            description:
              "Confirm the acceptance criteria of this revision cover the behavior, its boundaries and its failures. A new revision needs a new sign-off.",
            disciplineIds: [disciplineId],
          },
        ]),
  ];
}

// The Definition of Ready reads as a sentence per type, grouped by what the
// checks look at, so how each one works needs no further explanation.
export const readinessGroups: {
  id: string;
  title: string;
  kinds: ReadinessCheckKind[];
}[] = [
  { id: "written", title: "Written", kinds: ["specification", "section"] },
  {
    id: "reviewed",
    title: "Reviewed",
    kinds: [
      "reviews_requested",
      "reviews_approved",
      "discipline_approval",
      "no_blocking_threads",
    ],
  },
  {
    id: "intelligence",
    title: "Checked by Lictory Intelligence",
    kinds: ["intelligence_review"],
  },
  { id: "confirmed", title: "Confirmed by people", kinds: ["manual"] },
  { id: "decomposed", title: "Decomposed", kinds: ["children_ready"] },
];

const builtInLabels: Record<BuiltInReadinessKind, string> = {
  specification: "The specification is not empty",
  no_blocking_threads: "No blocking discussion is open",
  reviews_requested: "At least one required review is requested",
  reviews_approved: "Every required review approved the current revision",
  children_ready: "Every child specification is ready",
};

const joinNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

// Labels are derived from what a check verifies, so a name can never claim
// something the check does not do. Only sign-offs are named by people.
export function checkLabel(
  check: ReadinessCheckDefinition,
  disciplineName: (id: string) => string,
) {
  switch (check.kind) {
    case "section":
      return `It has a non-empty “${check.heading}” section`;
    case "discipline_approval":
      return `${joinNames(check.disciplineIds.map(disciplineName))} approved the current revision`;
    case "intelligence_review":
      return check.severity === "major"
        ? "Lictory Intelligence found no blocker or major finding in the current revision"
        : "Lictory Intelligence found no blocker in the current revision";
    case "manual":
      return check.label;
    default:
      return builtInLabels[check.kind];
  }
}

const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([x], [y]) => x.localeCompare(y)),
        )
      : v,
  );

// Stored rules come back from jsonb with reordered keys; compare by content.
export function sameReadinessChecks(
  a: ReadinessCheckDefinition[],
  b: ReadinessCheckDefinition[],
) {
  return canonical(a) === canonical(b);
}

// Equal when every type requires the same checks, counting a missing entry as
// the defaults.
export function sameReadinessRules(a: ReadinessRules, b: ReadinessRules) {
  const types = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...types].every((typeId) =>
    sameReadinessChecks(checksFor(a, typeId), checksFor(b, typeId)),
  );
}

export type ReadinessChange = {
  check: ReadinessCheckDefinition;
  change: "added" | "removed" | "changed";
};
// What a draft changes for one type, matched by check id.
export function diffReadinessChecks(
  before: ReadinessCheckDefinition[],
  after: ReadinessCheckDefinition[],
): ReadinessChange[] {
  const changes: ReadinessChange[] = [];
  for (const check of after) {
    const old = before.find((c) => c.id === check.id);
    if (!old) changes.push({ check, change: "added" });
    else if (!sameReadinessChecks([old], [check]))
      changes.push({ check, change: "changed" });
  }
  for (const check of before)
    if (!after.some((c) => c.id === check.id))
      changes.push({ check, change: "removed" });
  return changes;
}

const normalizeHeading = (text: string) =>
  text
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[:\s]+$/, "")
    .trim()
    .toLowerCase();

// Content under the first ATX heading named `heading` (any level), up to the
// next heading of the same or a higher level. Headings inside fenced code are
// text. Returns undefined when the section does not exist.
export function sectionContent(content: string, heading: string) {
  const wanted = normalizeHeading(heading);
  const lines = content.split(/\r?\n/);
  let fence: string | undefined;
  let level: number | undefined;
  const body: string[] = [];
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker.startsWith(fence))) {
      fence = fence ? undefined : marker;
      if (level !== undefined) body.push(line);
      continue;
    }
    const match = fence
      ? null
      : /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t#]*$/.exec(line);
    if (match) {
      const depth = match[1]!.length;
      if (level !== undefined && depth <= level) break;
      if (level === undefined && normalizeHeading(match[2] ?? "") === wanted) {
        level = depth;
        continue;
      }
    }
    if (level !== undefined) body.push(line);
  }
  return level === undefined ? undefined : body.join("\n");
}

function hasText(markdown: string) {
  return /\S/.test(markdown.replace(/<!--[\s\S]*?-->/g, ""));
}

export type ReadinessSignOff = {
  checkId: string;
  userId: string;
  revisionId: string;
  revisionNumber: number;
  createdAt: string;
};

// The latest completed Lictory Intelligence review of the item itself.
export type IntelligenceReviewEvidence = {
  runId: string;
  // The item's revision the review analysed.
  revisionId: string | null;
  // Severities of its findings about this item.
  severities: string[];
  score: number | null;
  model: string | null;
  completedAt: string | null;
};

// Everything the checks look at for one item, gathered by the server.
export type ReadinessEvidence = {
  content: string;
  revisionId: string | null;
  revisionNumber: number | null;
  blockingThreads: number;
  // Responsibilities of required, non-cancelled reviews.
  requiredResponsibilities: string[];
  // Required responsibilities whose current reviews are not all approved.
  missingResponsibilities: string[];
  // Responsibilities with a review of the current revision approved on it.
  approvedResponsibilities: string[];
  disciplineNames: Map<string, string>;
  childSpecifications: number;
  childSpecificationsNotReady: number;
  // Latest active sign-off per manual check (or override of an intelligence
  // check), on any revision.
  signOffs: Map<string, ReadinessSignOff>;
  intelligenceReview: IntelligenceReviewEvidence | null;
};

export type EvaluatedCheck = {
  key: string;
  label: string;
  passed: boolean;
  detail?: string;
  signOff?: {
    disciplineIds: string[];
    signedOffBy: string | null;
    signedOffAt: string | null;
  };
  // Intelligence checks: the review the result comes from, so the check stays
  // inspectable and visibly AI-originated. `overridden` when a person's
  // override, not the review, makes it pass.
  intelligence?: {
    runId: string | null;
    reviewedCurrent: boolean;
    findings: number;
    score: number | null;
    model: string | null;
    completedAt: string | null;
    overridden: boolean;
  };
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// Readiness is evidence. Each check explains itself so the UI never has to
// reduce readiness to a percentage without a reason. The result is JSON-stable
// (no undefined keys) so bootstrap and delta projections compare equal.
export function evaluateReadiness(
  definitions: ReadinessCheckDefinition[],
  evidence: ReadinessEvidence,
): EvaluatedCheck[] {
  const checks: EvaluatedCheck[] = [];
  const name = (d: string) =>
    evidence.disciplineNames.get(d) ?? "A former discipline";
  const add = (
    definition: ReadinessCheckDefinition,
    passed: boolean,
    detail?: string,
    extra?: Pick<EvaluatedCheck, "signOff" | "intelligence">,
  ) =>
    checks.push({
      key: definition.id,
      label: checkLabel(definition, name),
      passed,
      ...(!passed && detail ? { detail } : {}),
      ...extra,
    });
  const approved = new Set(
    evidence.approvedResponsibilities.map((r) => r.toLowerCase()),
  );
  const revision = evidence.revisionNumber ?? "";
  for (const definition of definitions) {
    switch (definition.kind) {
      case "specification":
        add(
          definition,
          evidence.content.trim().length > 0,
          "The description is empty.",
        );
        break;
      case "no_blocking_threads":
        add(
          definition,
          evidence.blockingThreads === 0,
          `${plural(evidence.blockingThreads, "blocking discussion")} open.`,
        );
        break;
      case "reviews_requested":
        add(
          definition,
          evidence.requiredResponsibilities.length > 0,
          "Request at least one required review.",
        );
        break;
      case "reviews_approved":
        add(
          definition,
          evidence.requiredResponsibilities.length > 0 &&
            evidence.missingResponsibilities.length === 0,
          evidence.requiredResponsibilities.length === 0
            ? "No required review exists yet."
            : `Waiting on ${evidence.missingResponsibilities.join(", ")} for revision ${revision}.`,
        );
        break;
      case "children_ready":
        // Only spec-backed children carry readiness; plain tasks never block it.
        if (evidence.childSpecifications === 0) break;
        add(
          definition,
          evidence.childSpecificationsNotReady === 0,
          `${evidence.childSpecificationsNotReady} of ${plural(evidence.childSpecifications, "child specification")} ${evidence.childSpecificationsNotReady === 1 ? "is" : "are"} not ready.`,
        );
        break;
      case "section": {
        const section = sectionContent(evidence.content, definition.heading);
        add(
          definition,
          section !== undefined && hasText(section),
          section === undefined
            ? `Add a “${definition.heading}” section.`
            : `The “${definition.heading}” section is empty.`,
        );
        break;
      }
      case "discipline_approval": {
        const waiting = definition.disciplineIds
          .map(name)
          .filter((n) => !approved.has(n.toLowerCase()));
        add(
          definition,
          waiting.length === 0,
          `Waiting on ${joinNames(waiting)} to approve revision ${revision}.`,
        );
        break;
      }
      case "intelligence_review": {
        const run = evidence.intelligenceReview;
        const failing = new Set<string>(
          definition.severity === "major" ? ["blocker", "major"] : ["blocker"],
        );
        const reviewedCurrent = Boolean(
          run && evidence.revisionId && run.revisionId === evidence.revisionId,
        );
        const findings = reviewedCurrent
          ? run!.severities.filter((x) => failing.has(x)).length
          : 0;
        const clean = reviewedCurrent && findings === 0;
        const override = evidence.signOffs.get(definition.id);
        const current =
          override?.revisionId === evidence.revisionId ? override : undefined;
        const what =
          definition.severity === "major"
            ? plural(
                findings,
                "blocker or major finding",
                "blocker or major findings",
              )
            : plural(findings, "blocker");
        add(
          definition,
          clean || Boolean(current),
          !run
            ? `Ask Lictory Intelligence to review revision ${revision}, or override this check.`
            : !reviewedCurrent
              ? `Lictory Intelligence reviewed an earlier revision. Ask it to review revision ${revision}, or override this check.`
              : `Lictory Intelligence found ${what} in revision ${revision}. Address ${findings === 1 ? "it" : "them"} and review again, or override this check.`,
          {
            // Overrides are recorded like sign-offs: a person, a revision.
            signOff: {
              disciplineIds: [],
              signedOffBy: current?.userId ?? null,
              signedOffAt: current?.createdAt ?? null,
            },
            intelligence: {
              runId: run?.runId ?? null,
              reviewedCurrent,
              findings,
              score: reviewedCurrent ? (run?.score ?? null) : null,
              model: run?.model ?? null,
              completedAt: run?.completedAt ?? null,
              overridden: !clean && Boolean(current),
            },
          },
        );
        break;
      }
      case "manual": {
        const signOff = evidence.signOffs.get(definition.id);
        const current =
          signOff?.revisionId === evidence.revisionId ? signOff : undefined;
        add(
          definition,
          Boolean(current),
          signOff
            ? `Signed off on revision ${signOff.revisionNumber}. Sign off again for revision ${revision}.`
            : (definition.description ?? "Waiting for a sign-off."),
          {
            signOff: {
              disciplineIds: definition.disciplineIds,
              signedOffBy: current?.userId ?? null,
              signedOffAt: current?.createdAt ?? null,
            },
          },
        );
        break;
      }
    }
  }
  return checks;
}

// What publishing a draft would do to the project's items, before it happens.
export const readinessImpactSchema = z.object({
  // Ready or done items that keep the version they were evaluated under.
  kept: z.number().int(),
  // Items following the latest version that would become ready.
  becomeReady: z.array(z.object({ id, key: z.string(), title: z.string() })),
  // Items following the latest version that fail a check the draft adds or
  // changes, with how many fail each such check.
  needMoreWork: z.array(z.object({ id, key: z.string(), title: z.string() })),
  reasons: z.array(z.object({ label: z.string(), count: z.number().int() })),
  // Items following the latest version whose outcome does not change.
  unaffected: z.number().int(),
});
export type ReadinessImpact = z.infer<typeof readinessImpactSchema>;
