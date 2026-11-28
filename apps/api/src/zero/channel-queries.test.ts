import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { zeroDrizzle } from "@rocicorp/zero/server/adapters/drizzle";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { postMessage } from "@lictory/core/channels/writer";
import { promoteMessage } from "@lictory/core/channels/promotion";
import { queries } from "@lictory/zero/queries";
import { schema } from "@lictory/zero/schema";

// Lictory Channels' synced queries, compiled by Zero to SQL and run against
// a disposable database: what each person's subscription would contain.
// Public channels reach the organization's members, private and direct ones
// only their members, nothing reaches another organization, and leaving
// removes the rows.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_channel_query_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 4, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
const zql = zeroDrizzle(schema, db);
let created = false;

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

type Row = { id?: string; channelId?: string; body?: string; userId?: string };
async function subscribe(
  name: keyof typeof queries,
  userID: string,
  args: Record<string, unknown>,
) {
  const query = (
    queries[name] as unknown as {
      fn: (input: { args: unknown; ctx: { userID: string } }) => unknown;
    }
  ).fn({ args, ctx: { userID } });
  return (await zql.run(query as Parameters<typeof zql.run>[0])) as Row[];
}

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

async function organization(members: [string, string][]) {
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: `org-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  });
  for (const [userId, role] of members)
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    });
  await seedOrganization(db, organizationId);
  return organizationId;
}

void test("channel rows reach exactly the people who can read the channel", async () => {
  const [owner, ada, bo, cy, outsider] = await Promise.all(
    ["Owner", "Ada", "Bo", "Cy", "Outsider"].map(user),
  );
  const organizationId = await organization([
    [owner!, "owner"],
    [ada!, "member"],
    [bo!, "member"],
    [cy!, "member"],
  ]);
  const elsewhere = await organization([[outsider!, "owner"]]);
  const run = (actor: string, command: Command) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command },
    );
  const general = crypto.randomUUID();
  const secret = crypto.randomUUID();
  await run(ada!, {
    type: "createChannel",
    channelId: general,
    kind: "public",
    name: "general",
  });
  await run(ada!, {
    type: "createChannel",
    channelId: secret,
    kind: "private",
    name: "secret",
    memberIds: [bo!],
  });
  const dm = crypto.randomUUID();
  await run(ada!, {
    type: "openDirectConversation",
    channelId: dm,
    userIds: [cy!],
  });
  const post = (
    actor: string,
    channelId: string,
    body: string,
    threadRootId?: string,
  ) =>
    db.transaction((tx) =>
      postMessage(
        tx,
        { userId: actor },
        { organizationId, channelId, body, threadRootId },
      ),
    );
  const { message: hello } = await post(ada!, general, "hello");
  await post(ada!, general, "reply", hello.id);
  const { message: hidden } = await post(ada!, secret, "hidden");
  await post(cy!, dm, "psst");
  const org = { organizationId };
  const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

  // Channels: everyone sees public ones; private and direct only members.
  assert.deepEqual(
    ids(await subscribe("channels", cy!, org)),
    [dm, general].sort(),
  );
  assert.deepEqual(
    ids(await subscribe("channels", bo!, org)),
    [general, secret].sort(),
  );
  assert.deepEqual(ids(await subscribe("channels", owner!, org)), [general]);
  assert.deepEqual(await subscribe("channels", outsider!, org), []);
  // An organization id the person belongs to does not unlock another's rows.
  assert.deepEqual(
    await subscribe("channelMessages", outsider!, {
      organizationId: elsewhere,
      channelId: secret,
      limit: 50,
    }),
    [],
  );

  const window = (userID: string, channelId: string) =>
    subscribe("channelMessages", userID, {
      organizationId,
      channelId,
      limit: 50,
    });
  assert.deepEqual(
    (await window(owner!, general)).map((r) => r.body),
    ["hello"],
  );
  assert.deepEqual(await window(cy!, secret), []);
  assert.deepEqual(await window(owner!, dm), []);
  assert.deepEqual(await window(outsider!, general), []);
  assert.deepEqual(
    (await window(bo!, secret)).map((r) => r.body),
    ["hidden"],
  );
  assert.deepEqual(
    (
      await subscribe("channelThread", cy!, {
        organizationId,
        channelId: general,
        rootMessageId: hello.id,
      })
    ).map((r) => r.body),
    ["hello", "reply"],
  );
  assert.deepEqual(
    await subscribe("channelThread", cy!, {
      organizationId,
      channelId: secret,
      rootMessageId: hidden.id,
    }),
    [],
  );
  assert.deepEqual(
    await subscribe("channelMessagesById", cy!, {
      organizationId,
      messageIds: [hidden.id],
    }),
    [],
  );
  // Members of a private channel are not visible to others either.
  assert.deepEqual(
    await subscribe("channelMembers", cy!, {
      organizationId,
      channelId: secret,
    }),
    [],
  );
  assert.equal(
    (
      await subscribe("channelMembers", bo!, {
        organizationId,
        channelId: secret,
      })
    ).length,
    2,
  );
  // Direct conversation members, for naming them.
  assert.deepEqual(
    (await subscribe("directConversationMembers", cy!, org))
      .map((r) => r.userId)
      .sort(),
    [ada!, cy!].sort(),
  );
  assert.deepEqual(await subscribe("directConversationMembers", bo!, org), []);
  // My memberships are mine only.
  assert.deepEqual(
    (await subscribe("myChannelMemberships", bo!, org))
      .map((r) => r.channelId)
      .sort(),
    [secret].sort(),
  );

  // Leaving a private channel removes its rows from the subscription.
  await run(ada!, {
    type: "addChannelMembers",
    channelId: secret,
    userIds: [cy!],
  });
  assert.equal((await window(cy!, secret)).length, 2);
  await run(cy!, { type: "leaveChannel", channelId: secret });
  assert.deepEqual(await window(cy!, secret), []);
  // Leaving the organization removes everything.
  await db.delete(s.member).where(eq(s.member.userId, bo!));
  assert.deepEqual(await subscribe("channels", bo!, org), []);
  assert.deepEqual(await window(bo!, general), []);

  // A promotion from a private channel is visible on the item only to
  // people who can read that channel.
  const projectId = crypto.randomUUID();
  await run(owner!, {
    type: "createProject",
    projectId,
    name: "Payments",
    key: "PAY",
  });
  const promoted = await promoteMessage(
    db,
    { userId: owner! },
    {
      organizationId,
      channelId: general,
      messageId: hello.id,
    },
    { kind: "proposal", projectId, title: "Hello" },
  );
  const conversations = (userID: string) =>
    subscribe("workItemConversations", userID, {
      organizationId,
      workItemId: promoted.workItemId,
    });
  assert.equal((await conversations(cy!)).length, 1);
  assert.deepEqual(await conversations(outsider!), []);
});
