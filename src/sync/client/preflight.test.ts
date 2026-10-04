import assert from "node:assert/strict";
import { test } from "node:test";
import type { Directory, WorkItem } from "../shared/protocol";
import { statusChangeBlocker } from "./preflight";

const item: WorkItem = {
  type: "workItem",
  id: "item",
  organizationId: "org",
  projectId: "project",
  teamId: "team",
  typeId: "story",
  parentId: null,
  number: 1,
  title: "A specification",
  statusId: "backlog",
  refinementState: "in_review",
  mainProtected: false,
  priority: "none",
  assigneeId: null,
  milestoneId: null,
  iterationId: null,
  estimate: null,
  labelIds: [],
  position: 0,
  rank: "a",
  sourceRevisionId: null,
  createdById: "user",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  archivedAt: null,
  revisionId: "revision",
  revisionNumber: 1,
  openThreads: 1,
  blockingThreads: 1,
  openSuggestions: 0,
  suggestionReviewerIds: [],
  reviews: [],
  readinessPassed: 3,
  readinessTotal: 5,
  childCount: 0,
  childReadyCount: 0,
  childDoneCount: 0,
  childEstimate: 0,
};
const directory: Directory = {
  ai: { enabled: false, available: false },
  organizations: [],
  members: [],
  roles: [],
  iterations: [],
  delivery: { connections: [], targets: [] },
  projects: [
    {
      type: "project",
      id: "project",
      organizationId: "org",
      name: "Project",
      slug: "lic",
      key: "LIC",
      description: null,
      defaultTeamId: "team",
      archivedAt: null,
    },
  ],
  teams: [
    {
      id: "team",
      name: "Team",
      description: null,
      deliveryMode: "native",
      readinessPolicy: "block",
      estimateScale: "none",
      iterationMode: "off",
      iterationWeeks: 2,
      iterationStartDay: 1,
      upcomingIterations: 2,
      aiActionPolicy: "advisory",
      memberIds: [],
      typeIds: ["story", "task"],
      archivedAt: null,
      statuses: [
        {
          id: "backlog",
          name: "Backlog",
          category: "backlog",
          color: "gray",
          position: 0,
          archivedAt: null,
        },
        {
          id: "started",
          name: "In progress",
          category: "started",
          color: "blue",
          position: 1,
          archivedAt: null,
        },
        {
          id: "done",
          name: "Done",
          category: "done",
          color: "green",
          position: 2,
          archivedAt: null,
        },
      ],
    },
  ],
  types: [
    {
      id: "story",
      name: "Story",
      icon: "story",
      color: "blue",
      level: 1,
      hasSpecification: true,
      position: 0,
      archivedAt: null,
    },
    {
      id: "task",
      name: "Task",
      icon: "task",
      color: "blue",
      level: 1,
      hasSpecification: false,
      position: 1,
      archivedAt: null,
    },
  ],
};
const command = {
  type: "updateWorkItem",
  workItemId: "item",
  statusId: "started",
} as const;
void test("readiness preflight gates only starting unready specification work under a blocking policy", () => {
  const entities = { "workItem:item": item };
  assert.match(
    statusChangeBlocker(command, entities, directory)!,
    /LIC-1 is not ready to start: 3\/5 readiness checks pass, 1 blocking discussion/,
  );
  for (const readinessPolicy of ["off", "warn"] as const)
    assert.equal(
      statusChangeBlocker(command, entities, {
        ...directory,
        teams: [{ ...directory.teams[0]!, readinessPolicy }],
      }),
      undefined,
    );
  for (const patch of [
    { refinementState: "ready" },
    { typeId: "task" },
    { statusId: "started" },
  ] as const)
    assert.equal(
      statusChangeBlocker(
        command,
        { "workItem:item": { ...item, ...patch } },
        directory,
      ),
      undefined,
    );
  assert.equal(
    statusChangeBlocker({ ...command, statusId: "done" }, entities, directory),
    undefined,
  );
  assert.equal(
    statusChangeBlocker(
      { type: "updateWorkItem", workItemId: item.id, priority: "high" },
      entities,
      directory,
    ),
    undefined,
  );
  assert.equal(statusChangeBlocker(command, {}, directory), undefined);
  assert.equal(
    statusChangeBlocker(command, entities, { ...directory, teams: [] }),
    undefined,
  );
  assert.equal(
    statusChangeBlocker({ ...command, typeId: "task" }, entities, directory),
    undefined,
  );
});
void test("preflight uses available readiness evidence and the destination team's policy", () => {
  const entities = {
    "workItem:item": item,
    "readiness:item": {
      type: "readiness" as const,
      id: item.id,
      organizationId: "org",
      checks: [
        {
          key: "reviews",
          label: "Current revision approved by every required review",
          passed: false,
        },
      ],
      workItemId: item.id,
    },
  };
  assert.match(
    statusChangeBlocker(command, entities, directory)!,
    /current revision approved by every required review/,
  );
  const warnTeam = {
    ...directory.teams[0]!,
    id: "warn-team",
    readinessPolicy: "warn" as const,
  };
  assert.equal(
    statusChangeBlocker({ ...command, teamId: warnTeam.id }, entities, {
      ...directory,
      teams: [...directory.teams, warnTeam],
    }),
    undefined,
  );
});
