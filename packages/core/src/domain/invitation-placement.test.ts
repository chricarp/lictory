import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Directory } from "@lictory/core/contracts/protocol";
import { executeMutation, directory } from "@lictory/core/domain/service";
import { seedOrganization } from "@lictory/core/domain/organization";
import {
  applyInvitationPlacement,
  invitationIntent,
  storeInvitationPlacement,
  validateInvitationPlacement,
} from "@lictory/core/domain/invitation-placement";

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const name = `lictory_invite_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${name}`;
const client = postgres(url.toString(), { max: 5, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;
before(async () => {
  await admin`CREATE DATABASE ${admin(name)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
});
after(async () => {
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  await admin.end();
});

void test("invitation placement applies on acceptance through audited, projected commands and rejects foreign projects", async () => {
  const inviterId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  await db.insert(s.user).values(
    [inviterId, userId].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
    })),
  );
  const organizationId = crypto.randomUUID();
  const foreignOrg = crypto.randomUUID();
  await db.insert(s.organization).values(
    [organizationId, foreignOrg].map((id) => ({
      id,
      name: id,
      slug: id,
      createdAt: new Date(),
    })),
  );
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId: inviterId,
    role: "admin",
    createdAt: new Date(),
  });
  await seedOrganization(db, organizationId);
  const projectId = crypto.randomUUID();
  await executeMutation(
    db,
    { userId: inviterId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: {
        type: "createProject",
        projectId,
        name: "Payments",
        key: "PAY",
      },
    },
  );
  const foreignProject = crypto.randomUUID();
  await db.insert(s.project).values({
    id: foreignProject,
    organizationId: foreignOrg,
    name: "Foreign",
    slug: "foreign",
    key: "FOR",
    createdById: inviterId,
  });
  await assert.rejects(
    validateInvitationPlacement(db, inviterId, organizationId, {
      projectId: foreignProject,
      disciplineIds: [],
    }),
    /Choose a project/,
  );
  const roster = await directory(db, inviterId, organizationId);
  const engineering = roster.disciplines.find(
    (d) => d.projectId === projectId && d.name === "Engineering",
  )!;
  const qa = roster.disciplines.find(
    (d) => d.projectId === projectId && d.name === "QA",
  )!;
  const invitationId = crypto.randomUUID();
  await db.insert(s.invitation).values({
    id: invitationId,
    organizationId,
    inviterId,
    email: `${userId}@example.test`,
    role: "member",
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await invitationIntent.run(
    {
      organizationId,
      inviterId,
      placement: { projectId, disciplineIds: [engineering.id, qa.id] },
    },
    () => storeInvitationPlacement(db, invitationId),
  );
  await assert.rejects(
    validateInvitationPlacement(db, inviterId, organizationId, {
      projectId: foreignProject,
      disciplineIds: [engineering.id],
    }),
  );
  // Better Auth owns these acceptance writes; its afterAcceptInvitation hook
  // calls the domain handler below after membership has been committed.
  await db.insert(s.member).values({
    id: crypto.randomUUID(),
    organizationId,
    userId,
    role: "member",
    createdAt: new Date(),
  });
  await db
    .update(s.invitation)
    .set({ status: "accepted" })
    .where(eq(s.invitation.id, invitationId));
  await db
    .delete(s.discipline)
    .where(
      and(
        eq(s.discipline.id, qa.id),
        eq(s.discipline.organizationId, organizationId),
      ),
    );
  await applyInvitationPlacement(db, invitationId, organizationId, userId);
  let accepted = await directory(db, userId, organizationId);
  assert.ok(
    accepted.projectMembers.some(
      (m) => m.projectId === projectId && m.userId === userId,
    ),
  );
  assert.ok(
    accepted.disciplines.some(
      (d) => d.id === engineering.id && d.userIds.includes(userId),
    ),
  );
  const audit = await db
    .select()
    .from(s.configurationAudit)
    .where(
      and(
        eq(s.configurationAudit.organizationId, organizationId),
        eq(s.configurationAudit.actorId, inviterId),
      ),
    );
  assert.ok(audit.some((a) => a.action === "setDisciplineMember"));
  const projections = await db
    .select()
    .from(s.syncEntity)
    .where(eq(s.syncEntity.organizationId, organizationId));
  const projected = projections.find((p) => p.type === "directory")!
    .data as unknown as Directory;
  assert.ok(
    projected.projectMembers.some(
      (m) => m.projectId === projectId && m.userId === userId,
    ),
  );
  assert.ok(
    projected.disciplines.some(
      (d) => d.id === engineering.id && d.userIds.includes(userId),
    ),
  );
  // A repeated hook must not resurrect membership removed after acceptance.
  await executeMutation(
    db,
    { userId: inviterId },
    {
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId,
      command: { type: "setProjectMember", projectId, userId, role: null },
    },
  );
  await applyInvitationPlacement(db, invitationId, organizationId, userId);
  accepted = await directory(db, userId, organizationId);
  assert.ok(
    !accepted.projectMembers.some(
      (m) => m.projectId === projectId && m.userId === userId,
    ),
  );
  // The inviter losing invitation authority skips placement without affecting
  // the accepted organization membership.
  const secondInvitationId = crypto.randomUUID();
  await db.insert(s.invitation).values({
    id: secondInvitationId,
    organizationId,
    inviterId,
    email: `${userId}@example.test`,
    role: "member",
    status: "pending",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await invitationIntent.run(
    {
      organizationId,
      inviterId,
      placement: { projectId, disciplineIds: [engineering.id] },
    },
    () => storeInvitationPlacement(db, secondInvitationId),
  );
  await db
    .update(s.invitation)
    .set({ status: "accepted" })
    .where(eq(s.invitation.id, secondInvitationId));
  await db
    .update(s.member)
    .set({ role: "member" })
    .where(
      and(
        eq(s.member.organizationId, organizationId),
        eq(s.member.userId, inviterId),
      ),
    );
  await applyInvitationPlacement(
    db,
    secondInvitationId,
    organizationId,
    userId,
  );
  accepted = await directory(db, userId, organizationId);
  assert.ok(accepted.members.some((m) => m.id === userId));
  assert.ok(
    !accepted.projectMembers.some(
      (m) => m.projectId === projectId && m.userId === userId,
    ),
  );
});
