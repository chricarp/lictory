import { expect, type Browser, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { seedOrganization } from "@lictory/core/domain/organization";
import { directory, executeMutation } from "@lictory/core/domain/service";
import {
  PROTOCOL,
  type Command,
  type ProjectSettings,
} from "@lictory/core/contracts/protocol";
import { consentStatePath } from "../consent-setup";
import { inApp } from "./app-urls";

// Workspaces seeded through the domain (the same writer the API uses), so
// projections and receipts are exactly what a browser-made workspace has.

export const password = "Seeded-test-password-123!";

export async function withDb<T>(
  fn: (db: ReturnType<typeof drizzle<typeof s>>) => Promise<T>,
) {
  const client = postgres(process.env.DATABASE_URL!, {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    return await fn(drizzle(client, { schema: s }));
  } finally {
    await client.end();
  }
}

export type SeedUser = {
  id: string;
  name: string;
  email: string;
  handle: string;
};

export type Seeded = Awaited<ReturnType<typeof seedWorkspace>>;

export async function seedWorkspace(options: {
  name: string;
  key: string;
  // First user owns the organization; the others are members.
  users: string[];
  settings?: Partial<ProjectSettings>;
  // Discipline name per additional user (index 1...), e.g. "QA".
  disciplines?: Record<number, string>;
}) {
  const run = crypto.randomUUID().slice(0, 8);
  return withDb(async (db) => {
    const hash = await hashPassword(password);
    const users: SeedUser[] = [];
    for (const name of options.users) {
      const id = crypto.randomUUID();
      const handle = `${name.toLowerCase().replaceAll(/[^a-z]+/g, "_")}_${run}`;
      const user = {
        id,
        name,
        email: `${handle}@example.test`,
        handle,
      };
      await db.insert(s.user).values({ ...user, emailVerified: true });
      await db.insert(s.account).values({
        id: crypto.randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: hash,
      });
      users.push(user);
    }
    const organizationId = crypto.randomUUID();
    const slug = `${options.key.toLowerCase()}-${run}`;
    await db.insert(s.organization).values({
      id: organizationId,
      name: options.name,
      slug,
      createdAt: new Date(),
    });
    await db.insert(s.member).values(
      users.map((user, index) => ({
        id: crypto.randomUUID(),
        organizationId,
        userId: user.id,
        role: index === 0 ? "owner" : "member",
        createdAt: new Date(),
      })),
    );
    await seedOrganization(db, organizationId);
    const owner = users[0]!;
    const execute = (target: typeof db, command: Command, actor: string) =>
      executeMutation(
        target,
        { userId: actor },
        {
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId,
          command,
        },
      );
    // Usable after seeding: each later command opens its own connection.
    const command = (next: Command, actor = owner.id) =>
      withDb((later) => execute(later, next, actor));
    const seedCommand = (next: Command, actor = owner.id) =>
      execute(db, next, actor);
    const projectId = crypto.randomUUID();
    await seedCommand({
      type: "createProject",
      projectId,
      name: `${options.name} project`,
      key: options.key,
    });
    if (options.settings)
      await seedCommand({
        type: "updateProject",
        projectId,
        ...options.settings,
      });
    const roster = await directory(db, owner.id, organizationId);
    for (const [index, discipline] of Object.entries(options.disciplines ?? {}))
      await seedCommand({
        type: "setDisciplineMember",
        projectId,
        disciplineId: roster.disciplines.find((d) => d.name === discipline)!.id,
        userId: users[Number(index)]!.id,
        member: true,
      });
    const typeId = (name: string) =>
      roster.types.find((t) => t.name === name)!.id;
    return {
      organizationId,
      projectId,
      slug,
      users,
      owner,
      typeId,
      roster,
      command,
      // `/{org}/{key}/items/KEY-n`
      itemPath: (number: number) =>
        `/${slug}/${options.key.toLowerCase()}/items/${options.key}-${number}`,
      projectPath: (rest = "") =>
        `/${slug}/${options.key.toLowerCase()}${rest}`,
    };
  });
}

// Creates a work item through the domain and returns its ID.
export async function seedItem(
  seeded: Seeded,
  item: { type?: string; title: string; description?: string },
) {
  const workItemId = crypto.randomUUID();
  await seeded.command({
    type: "createWorkItem",
    projectId: seeded.projectId,
    workItemId,
    typeId: seeded.typeId(item.type ?? "Story"),
    parentId: null,
    title: item.title,
    description: item.description ?? "",
  });
  return workItemId;
}

export async function currentRevision(workItemId: string) {
  return withDb(async (db) => {
    const [row] = await db
      .select({
        id: s.specificationRevision.id,
        number: s.specificationRevision.number,
        content: s.specificationRevision.content,
      })
      .from(s.specificationRevision)
      .where(eq(s.specificationRevision.workItemId, workItemId))
      .orderBy(desc(s.specificationRevision.number))
      .limit(1);
    return row!;
  });
}

export async function removeMember(organizationId: string, userId: string) {
  await withDb((db) =>
    db
      .delete(s.member)
      .where(
        and(
          eq(s.member.organizationId, organizationId),
          eq(s.member.userId, userId),
        ),
      ),
  );
}

export async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(inApp);
}

// A separate browser profile with its own client address (rate limits are
// per address).
export async function newPerson(browser: Browser, address: string) {
  const context = await browser.newContext({
    storageState: consentStatePath,
    extraHTTPHeaders: { "x-forwarded-for": address },
  });
  return { context, page: await context.newPage() };
}
