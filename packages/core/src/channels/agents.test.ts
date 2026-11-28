import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as s from "@lictory/core/db/schema";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { seedOrganization } from "@lictory/core/domain/organization";
import { executeMutation } from "@lictory/core/domain/service";
import { invoke } from "@lictory/core/capabilities/registry";
import { noEffects } from "@lictory/core/capabilities/core";
import {
  registerAgentDirectory,
  type AgentMentionEvent,
  type ChannelAgent,
} from "@lictory/core/channels/agents";
import { editMessage, postMessage } from "@lictory/core/channels/writer";

// Agents in channels through the AgentDirectory port (the Factory registers
// the real one), and the ChatProvider ownership rule.

const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const databaseName = `lictory_channel_agents_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const url = new URL(adminUrl);
url.pathname = `/${databaseName}`;
const client = postgres(url.toString(), { max: 4, onnotice: () => undefined });
const db = drizzle(client, { schema: s });
let created = false;

const agents: ChannelAgent[] = [];
const mentions: AgentMentionEvent[] = [];
// Access tokens bound to an agent identity, as the Factory would bind them.
const tokens = new Map<string, string>();

before(async () => {
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  created = true;
  await migrate(db, { migrationsFolder: "drizzle" });
  registerAgentDirectory({
    agents: async (_tx, _organizationId, ids) =>
      agents.filter((a) => ids.includes(a.id)),
    search: async (_tx, _organizationId, prefix, limit) =>
      agents.filter((a) => a.handle.startsWith(prefix)).slice(0, limit),
    actingAgent: async (_tx, _organizationId, actor) => {
      const agentId = actor.agentId ? tokens.get(actor.agentId) : undefined;
      return agents.find((a) => a.id === agentId) ?? null;
    },
    mentioned: async (_tx, event) => {
      mentions.push(event);
    },
  });
});
after(async () => {
  registerAgentDirectory({
    agents: async () => [],
    search: async () => [],
    actingAgent: async () => null,
  });
  await client.end();
  if (created) await admin`DROP DATABASE ${admin(databaseName)}`;
  await admin.end();
});

async function user(name: string) {
  const id = crypto.randomUUID();
  await db.insert(s.user).values({ id, name, email: `${id}@example.test` });
  return id;
}

void test("agents are members, authors acting via their person, and mentionable", async () => {
  const [ada, bo] = await Promise.all(["Ada", "Bo"].map(user));
  const organizationId = crypto.randomUUID();
  await db.insert(s.organization).values({
    id: organizationId,
    name: "Workspace",
    slug: `org-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  });
  for (const [userId, role] of [
    [ada!, "owner"],
    [bo!, "member"],
  ] as const)
    await db.insert(s.member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role,
      createdAt: new Date(),
    });
  await seedOrganization(db, organizationId);
  const forge = {
    id: crypto.randomUUID(),
    handle: "forge",
    name: "Forge",
    ownerId: ada!,
  };
  const rogue = {
    id: crypto.randomUUID(),
    handle: "rogue",
    name: "Rogue",
    ownerId: bo!,
  };
  agents.push(forge, rogue);
  tokens.set("token-forge", forge.id);
  // A token of Ada's that claims Bo's agent: never accepted.
  tokens.set("token-rogue", rogue.id);
  const run = (actor: string, command: Command) =>
    executeMutation(
      db,
      { userId: actor },
      { protocol: PROTOCOL, id: crypto.randomUUID(), organizationId, command },
    );
  const channelId = crypto.randomUUID();
  await run(ada!, {
    type: "createChannel",
    channelId,
    kind: "public",
    name: "builds",
  });
  await run(ada!, {
    type: "addChannelMembers",
    channelId,
    agentIds: [forge.id],
  });
  await assert.rejects(
    run(ada!, {
      type: "addChannelMembers",
      channelId,
      agentIds: [crypto.randomUUID()],
    }),
    /agents is unavailable/,
  );
  const [agentMember] = await db
    .select()
    .from(s.channelMember)
    .where(
      and(
        eq(s.channelMember.channelId, channelId),
        eq(s.channelMember.memberKind, "agent"),
      ),
    );
  assert.equal(agentMember?.agentId, forge.id);
  // The system line names the agent by handle.
  const lines = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.channelId, channelId));
  assert.match(
    lines.at(-1)!.body,
    new RegExp(`@\\[forge\\]\\(agent:${forge.id}\\)`),
  );

  // A call through Forge's token is Forge's message, via Ada.
  const posted = (await invoke(
    {
      db,
      principal: {
        userId: ada!,
        surface: "mcp",
        access: "write",
        tokenId: "token-forge",
        agentName: "Forge",
      },
      effects: noEffects,
    },
    "postChannelMessage",
    { organizationId, channelId, body: "Build 42 is green" },
  )) as { messageId: string };
  const [byAgent] = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.id, posted.messageId));
  assert.equal(byAgent?.authorKind, "agent");
  assert.equal(byAgent?.authorAgentId, forge.id);
  assert.equal(byAgent?.onBehalfOfUserId, ada);
  assert.equal(byAgent?.authorUserId, null);
  // An agent never acts for a different person: Bo's agent claimed through
  // Ada's token is ignored, and the message is Ada's own, via the token.
  const claimed = (await invoke(
    {
      db,
      principal: {
        userId: ada!,
        surface: "mcp",
        access: "write",
        tokenId: "token-rogue",
        agentName: "Rogue",
      },
      effects: noEffects,
    },
    "postChannelMessage",
    { organizationId, channelId, body: "Not Bo's agent" },
  )) as { messageId: string };
  const [mine] = await db
    .select()
    .from(s.channelMessage)
    .where(eq(s.channelMessage.id, claimed.messageId));
  assert.equal(mine?.authorKind, "user");
  assert.equal(mine?.authorUserId, ada);
  assert.equal(mine?.via, "Rogue");

  // Mentioning an agent records it and tells the Factory, in the message's
  // transaction; an unknown agent id stays text.
  await run(bo!, { type: "joinChannel", channelId });
  const { message } = await db.transaction((tx) =>
    postMessage(
      tx,
      { userId: bo! },
      {
        organizationId,
        channelId,
        body: `@[forge](agent:${forge.id}) please rerun, @[ghost](agent:${crypto.randomUUID()})`,
      },
    ),
  );
  assert.deepEqual(
    mentions.map((m) => [m.messageId, m.agentIds, m.mentionedById]),
    [[message.id, [forge.id], bo]],
  );
  const recorded = await db
    .select()
    .from(s.channelMention)
    .where(eq(s.channelMention.messageId, message.id));
  assert.deepEqual(
    recorded.map((r) => [r.mentionedKind, r.mentionedId]),
    [["agent", forge.id]],
  );

  // Direct conversations can include agents.
  const dm = (await invoke(
    { db, principal: { userId: bo!, surface: "web" }, effects: noEffects },
    "openDirectConversation",
    { organizationId, userIds: [], agentIds: [rogue.id] },
  )) as { channelId: string };
  const dmMembers = await db
    .select()
    .from(s.channelMember)
    .where(eq(s.channelMember.channelId, dm.channelId));
  assert.deepEqual(dmMembers.map((m) => m.memberKind).sort(), [
    "agent",
    "user",
  ]);

  // A message owned by an external chat system is changed only there.
  // The source name an adapter stores on the rows it owns.
  const slack = { id: "slack" };
  await db
    .update(s.channelMessage)
    .set({ externalSource: slack.id, externalId: "1700000000.0002" })
    .where(eq(s.channelMessage.id, message.id));
  await assert.rejects(
    db.transaction((tx) =>
      editMessage(
        tx,
        { userId: bo! },
        {
          organizationId,
          channelId,
          messageId: message.id,
          body: "edited here",
        },
      ),
    ),
    /written in slack/,
  );
});
