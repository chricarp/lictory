import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import {
  PROTOCOL,
  type Command,
  type SpaceAccessLevel,
} from "@lictory/core/contracts/protocol";
import {
  deleteAccount,
  recordDeparture,
} from "@lictory/core/domain/account-deletion";
import { readAuditLog } from "@lictory/core/domain/audit-log";
import { DomainError } from "@lictory/core/domain/errors";
import { seedOrganization } from "@lictory/core/domain/organization";
import { projectionDrift } from "@lictory/core/domain/projection-reader.test-helper";
import {
  rebuildProjections,
  refreshMemberships,
} from "@lictory/core/domain/projections";
import { executeMutation } from "@lictory/core/domain/service";
import {
  CapabilityError,
  noEffects,
  type Surface,
} from "@lictory/core/capabilities/core";
import { invoke } from "@lictory/core/capabilities/registry";
import {
  canCommentOnPage,
  canEditDraft,
  canManageSpaceAccess,
  canPublishPage,
  canReadSpace,
  canReviewPageChange,
  effectiveSpaceAccess,
  type SpaceAccessInputs,
} from "@lictory/core/spaces/access";
import {
  canReadDraft,
  canWriteDraft,
  draftDocumentName,
  resolveDraftDocument,
} from "@lictory/core/spaces/draft-access";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_spaces_domain_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
// Organizations whose tests write domain rows directly (branches, which have
// no command yet); the projection invariant skips them.
const bypassesDomain = new Set<string>();

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

async function addMember(
  organizationId: string,
  userId: string,
  role = "member",
) {
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role,
    createdAt: new Date(),
  });
}

// An organization with a project (the owner administers it), one of its
// teams, and people at every distance from them:
// - owner: organization owner and project administrator, not in the team;
// - alice: project member;
// - bob: team member (and so project member);
// - carol: organization member only.
async function fixture() {
  const organizationId = crypto.randomUUID();
  const [owner, alice, bob, carol] = await Promise.all(
    ["Owner", "Alice", "Bob", "Carol"].map(user),
  );
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: organizationId,
    createdAt: new Date(),
  });
  await addMember(organizationId, owner!, "owner");
  for (const id of [alice!, bob!, carol!]) await addMember(organizationId, id);
  await seedOrganization(db, organizationId);
  const run = (actor: string, command: Command, id = crypto.randomUUID()) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id, organizationId, command },
    );
  const projectId = crypto.randomUUID();
  const teamId = crypto.randomUUID();
  await run(owner!, {
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  await run(owner!, {
    type: "createTeam",
    projectId,
    teamId,
    name: "Platform",
  });
  await run(owner!, {
    type: "setProjectMember",
    projectId,
    userId: alice!,
    role: "member",
  });
  await run(owner!, {
    type: "setTeamMembership",
    projectId,
    teamId,
    userId: bob!,
    member: true,
  });
  const space = async (
    actor: string,
    options: Partial<Extract<Command, { type: "createSpace" }>> = {},
  ) => {
    const spaceId = crypto.randomUUID();
    await run(actor, {
      type: "createSpace",
      spaceId,
      name: options.name ?? "Handbook",
      slug: options.slug ?? `space-${spaceId.slice(0, 8)}`,
      ...options,
    });
    return spaceId;
  };
  const page = async (
    actor: string,
    spaceId: string,
    options: Partial<Extract<Command, { type: "createPage" }>> = {},
  ) => {
    const pageId = crypto.randomUUID();
    const result = await run(actor, {
      type: "createPage",
      spaceId,
      pageId,
      title: options.title ?? "Page",
      ...options,
    });
    // The receipt names what the command created.
    return result.summary as {
      pageId: string;
      mainBranchId: string;
      commitId: string;
      draftId?: string;
    };
  };
  const readers = async (spaceId: string) =>
    Object.fromEntries(
      (
        await db
          .select()
          .from(s.spaceReader)
          .where(eq(s.spaceReader.spaceId, spaceId))
      ).map((r) => [r.userId, r.level]),
    ) as Record<string, SpaceAccessLevel>;
  const actor = (userId: string) => ({ organizationId, userId });
  const tx = <T>(
    fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  ) => db.transaction(fn);
  return {
    organizationId,
    owner: owner!,
    alice: alice!,
    bob: bob!,
    carol: carol!,
    projectId,
    teamId,
    run,
    space,
    page,
    readers,
    actor,
    tx,
  };
}

async function rejects(
  promise: Promise<unknown>,
  category: DomainError["category"],
  message?: RegExp,
) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DomainError, String(error));
    assert.equal(error.category, category, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

const tree = async (spaceId: string) =>
  (
    await db
      .select({
        id: s.page.id,
        parentId: s.page.parentId,
        rank: s.page.rank,
        archivedAt: s.page.archivedAt,
      })
      .from(s.page)
      .where(eq(s.page.spaceId, spaceId))
  ).sort((a, b) => (a.rank < b.rank ? -1 : 1));

void test("effective access for every home, mode and grant", () => {
  const space = { id: "space", projectId: null, teamId: null };
  const homes = {
    organization: space,
    project: { ...space, projectId: "project" },
    team: { ...space, projectId: "project", teamId: "team" },
  } as const;
  const base = {
    memberIds: ["owner", "alice", "bob", "carol"],
    // `former` left the organization but keeps project, team and grant rows.
    projectMembers: ["owner", "alice", "bob", "former"].map((userId) => ({
      projectId: "project",
      userId,
    })),
    teamMembers: ["bob", "former"].map((userId) => ({
      teamId: "team",
      userId,
    })),
  };
  const inherited: Record<
    keyof typeof homes,
    Record<string, SpaceAccessLevel>
  > = {
    organization: { owner: "edit", alice: "edit", bob: "edit", carol: "edit" },
    project: { owner: "edit", alice: "edit", bob: "edit", carol: "view" },
    team: { owner: "view", alice: "view", bob: "edit", carol: "view" },
  };
  const levels = ["view", "comment", "edit"] as const;
  const max = (a: SpaceAccessLevel | undefined, b: SpaceAccessLevel) =>
    a && levels.indexOf(a) > levels.indexOf(b) ? a : b;
  for (const [home, homeSpace] of Object.entries(homes))
    for (const accessMode of ["inherited", "restricted"] as const)
      for (const grant of [null, ...levels]) {
        const inputs: SpaceAccessInputs = {
          ...base,
          spaces: [{ ...homeSpace, accessMode }],
          grants: [
            // Grants only add: bob's view never lowers his edit access.
            { spaceId: "space", userId: "bob", level: "view" },
            { spaceId: "space", userId: "former", level: "edit" },
            ...(grant
              ? [{ spaceId: "space", userId: "carol", level: grant }]
              : []),
          ],
        };
        const expected: Record<string, SpaceAccessLevel> = {
          ...(accessMode === "inherited"
            ? inherited[home as keyof typeof homes]
            : {}),
        };
        expected.bob = max(expected.bob, "view");
        if (grant) expected.carol = max(expected.carol, grant);
        const actual = Object.fromEntries(
          effectiveSpaceAccess(inputs).map((r) => [r.userId, r.level]),
        );
        assert.deepEqual(actual, expected, `${home} ${accessMode} ${grant}`);
      }
});

void test("space_reader follows the home, mode and grants as they change", async () => {
  const f = await fixture();
  const spaceId = await f.space(f.alice, { home: { projectId: f.projectId } });
  assert.deepEqual(await f.readers(spaceId), {
    [f.owner]: "edit",
    [f.alice]: "edit",
    [f.bob]: "edit",
    [f.carol]: "view",
  });
  // Moving the home to the team: only the team edits.
  await f.run(f.owner, {
    type: "updateSpace",
    spaceId,
    home: { projectId: f.projectId, teamId: f.teamId },
  });
  assert.deepEqual(await f.readers(spaceId), {
    [f.owner]: "view",
    [f.alice]: "view",
    [f.bob]: "edit",
    [f.carol]: "view",
  });
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId,
    userId: f.carol,
    level: "comment",
  });
  assert.equal((await f.readers(spaceId))[f.carol], "comment");
  // Restricting: only named people; the person restricting keeps edit.
  await f.run(f.owner, {
    type: "setSpaceAccessMode",
    spaceId,
    accessMode: "restricted",
  });
  assert.deepEqual(await f.readers(spaceId), {
    [f.owner]: "edit",
    [f.carol]: "comment",
  });
  // Back to inherited: grants are kept and still add.
  await f.run(f.owner, {
    type: "setSpaceAccessMode",
    spaceId,
    accessMode: "inherited",
  });
  assert.deepEqual(await f.readers(spaceId), {
    [f.owner]: "edit",
    [f.alice]: "view",
    [f.bob]: "edit",
    [f.carol]: "comment",
  });
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId,
    userId: f.carol,
    level: null,
  });
  assert.equal((await f.readers(spaceId))[f.carol], "view");
  // Grants name organization members only.
  const stranger = await user("Stranger");
  await rejects(
    f.run(f.owner, {
      type: "setSpaceGrant",
      spaceId,
      userId: stranger,
      level: "view",
    }),
    "not_found",
  );
  // Access, home and publishing changes are audited with identifiers only.
  const audit = await db
    .select({
      action: s.configurationAudit.action,
      detail: s.configurationAudit.detail,
    })
    .from(s.configurationAudit)
    .where(eq(s.configurationAudit.organizationId, f.organizationId));
  const spaceAudit = audit.filter(
    (a) => (a.detail.command as { spaceId?: string }).spaceId === spaceId,
  );
  assert.deepEqual(
    spaceAudit.map((a) => a.action),
    [
      "createSpace",
      "updateSpace",
      "setSpaceGrant",
      "setSpaceAccessMode",
      "setSpaceAccessMode",
      "setSpaceGrant",
    ],
  );
  assert.ok(!JSON.stringify(spaceAudit).includes("Handbook"));
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("inherited access is live: project, team and organization membership change it in the same transaction", async () => {
  const f = await fixture();
  const teamSpace = await f.space(f.alice, {
    home: { projectId: f.projectId, teamId: f.teamId },
  });
  const projectSpace = await f.space(f.alice, {
    home: { projectId: f.projectId },
  });
  const orgSpace = await f.space(f.alice);
  // Joining the team: edit in the team's spaces (and the project's, as a
  // project member).
  await f.run(f.owner, {
    type: "setTeamMembership",
    projectId: f.projectId,
    teamId: f.teamId,
    userId: f.carol,
    member: true,
  });
  assert.equal((await f.readers(teamSpace))[f.carol], "edit");
  assert.equal((await f.readers(projectSpace))[f.carol], "edit");
  // Leaving the team keeps project membership.
  await f.run(f.owner, {
    type: "setTeamMembership",
    projectId: f.projectId,
    teamId: f.teamId,
    userId: f.carol,
    member: false,
  });
  assert.equal((await f.readers(teamSpace))[f.carol], "view");
  assert.equal((await f.readers(projectSpace))[f.carol], "edit");
  // Leaving the project: view only.
  await f.run(f.owner, {
    type: "setProjectMember",
    projectId: f.projectId,
    userId: f.carol,
    role: null,
  });
  assert.equal((await f.readers(projectSpace))[f.carol], "view");
  // Joining a discipline makes a project member.
  const product = await db
    .select({ id: s.discipline.id })
    .from(s.discipline)
    .where(
      and(
        eq(s.discipline.projectId, f.projectId),
        eq(s.discipline.name, "Product"),
      ),
    );
  await f.run(f.owner, {
    type: "setDisciplineMember",
    projectId: f.projectId,
    disciplineId: product[0]!.id,
    userId: f.carol,
    member: true,
  });
  assert.equal((await f.readers(projectSpace))[f.carol], "edit");
  // Organization membership (Better Auth commits it; its hooks refresh).
  const dave = await user("Dave");
  await addMember(f.organizationId, dave);
  await refreshMemberships(db, [f.organizationId], dave);
  assert.equal((await f.readers(orgSpace))[dave], "edit");
  assert.equal((await f.readers(teamSpace))[dave], "view");
  await db
    .delete(s.member)
    .where(
      and(
        eq(s.member.organizationId, f.organizationId),
        eq(s.member.userId, dave),
      ),
    );
  // Before the hook runs, the domain checks already refuse a removed member.
  assert.equal(await canReadSpace(db, f.actor(dave), orgSpace), false);
  await recordDeparture(db, f.organizationId, dave);
  for (const spaceId of [orgSpace, teamSpace, projectSpace])
    assert.equal((await f.readers(spaceId))[dave], undefined);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("a restricted space stays hidden from organization administrators until they grant themselves access, which is audited", async () => {
  const f = await fixture();
  const spaceId = await f.space(f.bob, {
    accessMode: "restricted",
    name: "Security incidents",
  });
  // The creator holds an edit grant; nobody else reads it.
  assert.deepEqual(await f.readers(spaceId), { [f.bob]: "edit" });
  assert.equal(await canReadSpace(db, f.actor(f.owner), spaceId), false);
  assert.equal(await canManageSpaceAccess(db, f.actor(f.owner), spaceId), true);
  assert.equal(
    await canManageSpaceAccess(db, f.actor(f.carol), spaceId),
    false,
  );
  const owner = {
    db,
    principal: { userId: f.owner, surface: "web" as const },
    effects: noEffects,
  };
  const listed = (await invoke(owner, "listSpaces", {
    organizationId: f.organizationId,
  })) as {
    spaces: { id: string }[];
    manageableWithoutAccess: { id: string; name: string }[];
  };
  assert.ok(!listed.spaces.some((x) => x.id === spaceId));
  assert.deepEqual(listed.manageableWithoutAccess, [
    { id: spaceId, name: "Security incidents", accessMode: "restricted" },
  ]);
  // Administering is not reading: pages stay out of reach, as for anyone
  // without access (the space reads as unavailable).
  await rejects(f.page(f.owner, spaceId), "not_found");
  const { pageId } = await f.page(f.bob, spaceId, { title: "Breach drill" });
  await assert.rejects(
    invoke(owner, "getPage", { organizationId: f.organizationId, pageId }),
    (e) => e instanceof CapabilityError && e.category === "not_found",
  );
  // A member who is not an administrator cannot even tell it exists.
  await rejects(
    f.run(f.carol, {
      type: "setSpaceGrant",
      spaceId,
      userId: f.carol,
      level: "view",
    }),
    "not_found",
  );
  // The self-grant.
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId,
    userId: f.owner,
    level: "view",
  });
  assert.equal(await canReadSpace(db, f.actor(f.owner), spaceId), true);
  const page = (await invoke(owner, "getPage", {
    organizationId: f.organizationId,
    pageId,
  })) as { title: string; markdown: string };
  assert.equal(page.title, "Breach drill");
  const [entry] = await db
    .select()
    .from(s.configurationAudit)
    .where(
      and(
        eq(s.configurationAudit.organizationId, f.organizationId),
        eq(s.configurationAudit.action, "setSpaceGrant"),
      ),
    );
  assert.equal(entry?.actorId, f.owner);
  assert.deepEqual(entry?.detail, {
    command: {
      type: "setSpaceGrant",
      spaceId,
      userId: f.owner,
      level: "view",
    },
    previous: { level: null },
    accessMode: "restricted",
    selfGrant: true,
  });
  // Administrators read it in the audit log in words.
  const log = await readAuditLog(db, f.owner, f.organizationId, {
    category: "configuration",
  });
  assert.ok(
    log.entries.some(
      (e) =>
        e.summary === "Granted themselves view access to Security incidents",
    ),
    JSON.stringify(log.entries.map((e) => e.summary)),
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("identifiers from another organization are rejected", async () => {
  const f = await fixture();
  const g = await fixture();
  const foreignSpace = await g.space(g.owner);
  const { pageId: foreignPage } = await g.page(g.owner, foreignSpace);
  const spaceId = await f.space(f.owner);
  const { pageId } = await f.page(f.owner, spaceId);
  await rejects(f.page(f.owner, foreignSpace), "not_found");
  await rejects(
    f.run(f.owner, {
      type: "setSpaceGrant",
      spaceId: foreignSpace,
      userId: f.carol,
      level: "edit",
    }),
    "not_found",
  );
  await rejects(
    f.run(f.owner, {
      type: "archiveSpace",
      spaceId: foreignSpace,
      archived: true,
    }),
    "not_found",
  );
  await rejects(
    f.run(f.owner, { type: "movePage", pageId: foreignPage, parentId: null }),
    "not_found",
  );
  await rejects(
    f.run(f.owner, { type: "movePage", pageId, parentId: foreignPage }),
    "not_found",
  );
  await rejects(
    f.run(f.owner, {
      type: "archivePage",
      pageId: foreignPage,
      archived: true,
    }),
    "not_found",
  );
  await rejects(
    f.space(f.owner, { home: { projectId: g.projectId } }),
    "not_found",
  );
  await rejects(
    f.space(f.owner, { home: { projectId: f.projectId, teamId: g.teamId } }),
    "not_found",
  );
  await rejects(
    f.run(f.owner, {
      type: "setSpaceGrant",
      spaceId,
      userId: g.carol,
      level: "view",
    }),
    "not_found",
  );
  // A client-chosen id already used elsewhere is a conflict, not a takeover.
  await rejects(
    f.run(f.owner, {
      type: "createPage",
      spaceId,
      pageId: foreignPage,
      title: "Mine",
    }),
    "conflict",
  );
  // Outsiders are refused at the membership boundary.
  await rejects(f.page(g.owner, spaceId), "forbidden");
  assert.equal(
    (await db.select().from(s.page).where(eq(s.page.id, foreignPage)))[0]
      ?.organizationId,
    g.organizationId,
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  assert.deepEqual(await projectionDrift(db, g.organizationId), []);
});

void test("pages form a tree within their space: ordering, moves, cycles and subtree archive", async () => {
  const f = await fixture();
  const spaceId = await f.space(f.alice);
  const other = await f.space(f.alice);
  const a = (await f.page(f.alice, spaceId, { title: "A" })).pageId;
  const c = (await f.page(f.alice, spaceId, { title: "C" })).pageId;
  const b = (
    await f.page(f.alice, spaceId, { title: "B", afterId: a, beforeId: c })
  ).pageId;
  assert.deepEqual(
    (await tree(spaceId)).map((p) => p.id),
    [a, b, c],
  );
  const a1 = (await f.page(f.alice, spaceId, { title: "A1", parentId: a }))
    .pageId;
  const a1x = (await f.page(f.alice, spaceId, { title: "A1x", parentId: a1 }))
    .pageId;
  // Neighbours must be siblings under the target parent.
  await rejects(
    f.page(f.alice, spaceId, { title: "Bad", parentId: a, afterId: b }),
    "validation",
  );
  // Cycles.
  await rejects(
    f.run(f.alice, { type: "movePage", pageId: a, parentId: a1x }),
    "validation",
    /under itself or one of its own subpages/,
  );
  await rejects(
    f.run(f.alice, { type: "movePage", pageId: a, parentId: a }),
    "validation",
  );
  // Moves stay within the space.
  const elsewhere = (await f.page(f.alice, other)).pageId;
  await rejects(
    f.run(f.alice, { type: "movePage", pageId: a1, parentId: elsewhere }),
    "validation",
    /within their space/,
  );
  // A move to the top level, first.
  await f.run(f.alice, {
    type: "movePage",
    pageId: a1,
    parentId: null,
    beforeId: a,
  });
  const roots = (await tree(spaceId)).filter((p) => p.parentId === null);
  assert.deepEqual(
    roots.map((p) => p.id),
    [a1, a, b, c],
  );
  // Back under A; A1x follows its parent.
  await f.run(f.alice, { type: "movePage", pageId: a1, parentId: a });
  // Archiving archives the subtree; restoring restores what went with it.
  await f.run(f.alice, { type: "archivePage", pageId: a1x, archived: true });
  await f.run(f.alice, { type: "archivePage", pageId: a, archived: true });
  const archived = await tree(spaceId);
  assert.ok(archived.find((p) => p.id === a)?.archivedAt);
  assert.ok(archived.find((p) => p.id === a1)?.archivedAt);
  await rejects(
    f.page(f.alice, spaceId, { title: "Under archived", parentId: a }),
    "conflict",
  );
  await rejects(
    f.run(f.alice, { type: "archivePage", pageId: a1, archived: false }),
    "conflict",
    /parent page is archived/,
  );
  await rejects(
    f.run(f.alice, { type: "movePage", pageId: b, parentId: a }),
    "conflict",
  );
  await f.run(f.alice, { type: "archivePage", pageId: a, archived: false });
  const restored = await tree(spaceId);
  assert.equal(restored.find((p) => p.id === a)?.archivedAt, null);
  assert.equal(restored.find((p) => p.id === a1)?.archivedAt, null);
  // Archived on its own earlier, so it stays archived.
  assert.ok(restored.find((p) => p.id === a1x)?.archivedAt);
  // The tree read follows the same order and hides archived pages.
  const web = {
    db,
    principal: { userId: f.carol, surface: "web" as const },
    effects: noEffects,
  };
  const listed = (await invoke(web, "listPages", {
    organizationId: f.organizationId,
    spaceId,
  })) as { pages: { id: string; depth: number; title: string }[] };
  assert.deepEqual(
    listed.pages.map((p) => [p.title, p.depth]),
    [
      ["A", 0],
      ["A1", 1],
      ["B", 0],
      ["C", 0],
    ],
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("a new page has main, an immutable first commit and, in Direct spaces only, main's live draft", async () => {
  const f = await fixture();
  const direct = await f.space(f.alice);
  const created = await f.page(f.alice, direct, { title: "Retries" });
  const [commit] = await db
    .select()
    .from(s.pageCommit)
    .where(eq(s.pageCommit.pageId, created.pageId));
  assert.equal(commit?.id, created.commitId);
  assert.equal(commit?.title, "Retries");
  assert.deepEqual(commit?.content, {
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  assert.equal(commit?.markdown, "");
  assert.match(commit.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(commit?.contributorIds, [f.alice]);
  const [main] = await db
    .select()
    .from(s.pageBranch)
    .where(eq(s.pageBranch.pageId, created.pageId));
  assert.equal(main?.isMain, true);
  assert.equal(main?.headCommitId, created.commitId);
  const ref = await resolveDraftDocument(
    db,
    draftDocumentName({ draftId: created.draftId!, epoch: 1 }),
  );
  assert.deepEqual(ref, {
    organizationId: f.organizationId,
    draftId: created.draftId,
    epoch: 1,
  });
  assert.equal(await resolveDraftDocument(db, `${created.draftId}.2`), null);
  assert.equal(await resolveDraftDocument(db, "not a document"), null);

  const reviewed = await f.space(f.alice, { publishing: "reviewed" });
  const protectedPage = await f.page(f.alice, reviewed, { title: "Policy" });
  assert.equal(protectedPage.draftId, undefined);
  assert.equal(
    await canEditDraft(db, f.actor(f.alice), protectedPage.mainBranchId),
    false,
  );

  // Requiring reviews closes main's drafts; going back opens a new epoch.
  await rejects(
    f.run(f.carol, {
      type: "updateSpace",
      spaceId: direct,
      publishing: "reviewed",
    }),
    "forbidden",
  );
  await db
    .update(s.spaceDraft)
    .set({ sequence: 3 })
    .where(eq(s.spaceDraft.id, created.draftId!));
  await rejects(
    f.run(f.owner, {
      type: "updateSpace",
      spaceId: direct,
      publishing: "reviewed",
    }),
    "conflict",
    /unpublished changes/,
  );
  await db
    .update(s.spaceDraft)
    .set({ committedSequence: 3 })
    .where(eq(s.spaceDraft.id, created.draftId!));
  await f.run(f.owner, {
    type: "updateSpace",
    spaceId: direct,
    publishing: "reviewed",
  });
  assert.equal(await resolveDraftDocument(db, `${created.draftId}.1`), null);
  await f.run(f.owner, {
    type: "updateSpace",
    spaceId: direct,
    publishing: "direct",
  });
  assert.equal(await resolveDraftDocument(db, `${created.draftId}.1`), null);
  assert.ok(await resolveDraftDocument(db, `${created.draftId}.2`));
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("draft access adapters apply the domain checks: levels, archive, main policy and branch collaborators", async () => {
  const f = await fixture();
  bypassesDomain.add(f.organizationId);
  const spaceId = await f.space(f.bob, {
    home: { projectId: f.projectId, teamId: f.teamId },
  });
  await f.run(f.owner, {
    type: "setSpaceGrant",
    spaceId,
    userId: f.carol,
    level: "comment",
  });
  const created = await f.page(f.bob, spaceId, { title: "Runbook" });
  const ref = {
    organizationId: f.organizationId,
    draftId: created.draftId!,
    epoch: 1,
  };
  const can = (check: typeof canReadDraft, userId: string) =>
    f.tx((tx) => check(tx, userId, ref));
  assert.equal(await can(canReadDraft, f.alice), true);
  assert.equal(await can(canWriteDraft, f.alice), false);
  assert.equal(await can(canWriteDraft, f.bob), true);
  assert.equal(
    await canCommentOnPage(db, f.actor(f.carol), created.pageId),
    true,
  );
  assert.equal(
    await canCommentOnPage(db, f.actor(f.alice), created.pageId),
    false,
  );
  assert.equal(await canPublishPage(db, f.actor(f.bob), created.pageId), true);
  assert.equal(
    await canPublishPage(db, f.actor(f.carol), created.pageId),
    false,
  );
  assert.equal(
    await canReviewPageChange(db, f.actor(f.bob), created.pageId),
    true,
  );
  assert.equal(
    await canReviewPageChange(db, f.actor(f.bob), created.pageId, [f.bob]),
    false,
  );
  // A named branch: its author and collaborators edit it, other editors do not.
  const editor = await user("Erin");
  await addMember(f.organizationId, editor);
  await refreshMemberships(db, [f.organizationId], editor);
  await f.run(f.owner, {
    type: "setTeamMembership",
    projectId: f.projectId,
    teamId: f.teamId,
    userId: editor,
    member: true,
  });
  const branchId = crypto.randomUUID();
  await db.insert(s.pageBranch).values({
    id: branchId,
    organizationId: f.organizationId,
    pageId: created.pageId,
    name: "retry-policy",
    headCommitId: created.commitId,
    baseCommitId: created.commitId,
    authorId: f.bob,
  });
  assert.equal(await canEditDraft(db, f.actor(f.bob), branchId), true);
  assert.equal(await canEditDraft(db, f.actor(editor), branchId), false);
  await db.insert(s.pageBranchCollaborator).values({
    organizationId: f.organizationId,
    branchId,
    userId: editor,
  });
  assert.equal(await canEditDraft(db, f.actor(editor), branchId), true);
  // A collaborator without edit access to the space cannot write.
  await db.insert(s.pageBranchCollaborator).values({
    organizationId: f.organizationId,
    branchId,
    userId: f.carol,
  });
  assert.equal(await canEditDraft(db, f.actor(f.carol), branchId), false);
  // Archiving the page or the space stops writing; reading stays.
  await f.run(f.bob, {
    type: "archivePage",
    pageId: created.pageId,
    archived: true,
  });
  assert.equal(await can(canWriteDraft, f.bob), false);
  assert.equal(await can(canReadDraft, f.bob), true);
  await f.run(f.bob, {
    type: "archivePage",
    pageId: created.pageId,
    archived: false,
  });
  await f.run(f.bob, { type: "archiveSpace", spaceId, archived: true });
  assert.equal(await can(canWriteDraft, f.bob), false);
  await rejects(f.page(f.bob, spaceId), "conflict", /Restore/);
});

void test("space details are editors', home and publishing administrators', and handles stay unique among active spaces", async () => {
  const f = await fixture();
  const spaceId = await f.space(f.bob, {
    slug: "runbooks",
    home: { projectId: f.projectId, teamId: f.teamId },
  });
  // Viewers cannot rename; editors can.
  await rejects(
    f.run(f.alice, { type: "updateSpace", spaceId, name: "Mine" }),
    "forbidden",
    /view Handbook but not edit/,
  );
  await f.run(f.bob, {
    type: "updateSpace",
    spaceId,
    name: "Runbooks",
    icon: "book",
  });
  // The creator administers; project administrators too; other editors not.
  const other = await f.space(f.alice, {
    home: { projectId: f.projectId, teamId: f.teamId },
  });
  await rejects(
    f.run(f.bob, { type: "updateSpace", spaceId: other, home: {} }),
    "forbidden",
  );
  await f.run(f.owner, { type: "updateSpace", spaceId: other, home: {} });
  assert.equal((await f.readers(other))[f.carol], "edit");
  await rejects(f.space(f.alice, { slug: "runbooks" }), "conflict", /handle/);
  await f.run(f.bob, { type: "archiveSpace", spaceId, archived: true });
  await rejects(
    f.run(f.bob, { type: "updateSpace", spaceId, name: "Again" }),
    "conflict",
  );
  // An archived space frees its handle; restoring needs it back.
  const successor = await f.space(f.alice, { slug: "runbooks" });
  await rejects(
    f.run(f.bob, { type: "archiveSpace", spaceId, archived: false }),
    "conflict",
    /handle/,
  );
  await f.run(f.alice, {
    type: "updateSpace",
    spaceId: successor,
    slug: "runbooks-2",
  });
  await f.run(f.bob, { type: "archiveSpace", spaceId, archived: false });
  // Archived projects take no new spaces.
  await f.run(f.owner, {
    type: "archiveProject",
    projectId: f.projectId,
    archived: true,
  });
  await rejects(
    f.space(f.owner, { home: { projectId: f.projectId } }),
    "conflict",
  );
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("capability refusals are the same on every surface", async () => {
  const f = await fixture();
  const restricted = await f.space(f.bob, { accessMode: "restricted" });
  const { pageId } = await f.page(f.bob, restricted);
  const teamSpace = await f.space(f.bob, {
    home: { projectId: f.projectId, teamId: f.teamId },
  });
  const surfaces: Surface[] = ["web", "mcp", "agent"];
  const outcome = async (promise: Promise<unknown>) =>
    promise.then(
      () => "ok",
      (e: unknown) =>
        e instanceof CapabilityError
          ? `${e.category}: ${e.message}`
          : String(e),
    );
  const as = (surface: Surface, userId = f.carol) => ({
    db,
    principal: { userId, surface },
    effects: noEffects,
  });
  for (const [name, input] of [
    ["getPage", { organizationId: f.organizationId, pageId }],
    ["listPages", { organizationId: f.organizationId, spaceId: restricted }],
    [
      "createPage",
      { organizationId: f.organizationId, spaceId: teamSpace, title: "No" },
    ],
    [
      "setSpaceGrant",
      {
        organizationId: f.organizationId,
        spaceId: teamSpace,
        userId: f.carol,
        level: "edit",
      },
    ],
  ] as const) {
    const results = await Promise.all(
      surfaces.map((surface) => outcome(invoke(as(surface), name, input))),
    );
    assert.equal(new Set(results).size, 1, `${name}: ${results.join(" | ")}`);
    assert.notEqual(results[0], "ok");
  }
  // Another organization's member is refused the same way everywhere.
  const g = await fixture();
  const results = await Promise.all(
    surfaces.map((surface) =>
      outcome(
        invoke(as(surface, g.owner), "listSpaces", {
          organizationId: f.organizationId,
        }),
      ),
    ),
  );
  // MCP resolves organization references among memberships first, so the
  // wording differs; the decision does not.
  for (const result of results) assert.match(result, /^forbidden/);
});

void test("deleting an account removes its named access and effective access; history stays attributed", async () => {
  const f = await fixture();
  const spaceId = await f.space(f.bob, { accessMode: "restricted" });
  await f.run(f.bob, {
    type: "setSpaceGrant",
    spaceId,
    userId: f.carol,
    level: "edit",
  });
  const { pageId } = await f.page(f.carol, spaceId, { title: "Carol's page" });
  await deleteAccount(db, f.carol);
  assert.deepEqual(await f.readers(spaceId), { [f.bob]: "edit" });
  const grants = await db
    .select()
    .from(s.spaceGrant)
    .where(eq(s.spaceGrant.spaceId, spaceId));
  assert.deepEqual(
    grants.map((g) => g.userId),
    [f.bob],
  );
  const [page] = await db.select().from(s.page).where(eq(s.page.id, pageId));
  assert.equal(page?.createdById, f.carol);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
});

void test("projections equal a rebuild, and the rebuild repairs drift", async () => {
  const f = await fixture();
  const spaceId = await f.space(f.alice);
  const { pageId } = await f.page(f.alice, spaceId, { title: "Original" });
  // Corrupt the projections and effective access.
  await db
    .update(s.spaceEntity)
    .set({ data: { broken: true } })
    .where(eq(s.spaceEntity.key, `page:${pageId}`));
  await db
    .delete(s.spaceEntity)
    .where(eq(s.spaceEntity.key, `space:${spaceId}`));
  await db
    .delete(s.spaceReader)
    .where(
      and(
        eq(s.spaceReader.spaceId, spaceId),
        eq(s.spaceReader.userId, f.carol),
      ),
    );
  await db.insert(s.spaceEntity).values({
    key: "page:ghost",
    organizationId: f.organizationId,
    spaceId,
    type: "page",
    data: {},
  });
  assert.deepEqual(
    await projectionDrift(db, f.organizationId),
    [
      "extra page:ghost",
      `missing space:${spaceId}`,
      `stale page:${pageId}`,
      `stale spaceReader:${spaceId}:${f.carol}`,
    ].sort(),
  );
  const result = await rebuildProjections(db, f.organizationId);
  assert.equal(result.spaces.upserted, 2);
  assert.equal(result.spaces.deleted, 1);
  assert.equal(result.spaces.readersChanged, 1);
  assert.deepEqual(await projectionDrift(db, f.organizationId), []);
  // Space rows never reach sync_entity or the directory.
  const synced = await db
    .select({ key: s.syncEntity.key, data: s.syncEntity.data })
    .from(s.syncEntity)
    .where(eq(s.syncEntity.organizationId, f.organizationId));
  const serialized = JSON.stringify(synced);
  assert.ok(!serialized.includes(spaceId));
  assert.ok(!serialized.includes("Original"));
});

void test("every organization's projections equal a rebuild from the domain", async () => {
  const drift: string[] = [];
  for (const { id } of await db
    .select({ id: s.organization.id })
    .from(s.organization))
    if (!bypassesDomain.has(id)) drift.push(...(await projectionDrift(db, id)));
  assert.deepEqual(drift, []);
});
