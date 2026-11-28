import { and, eq, gt, inArray, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Database, Tx } from "@lictory/core/domain/service";
import type { SlackClient } from "@lictory/core/channels/slack/api";
import type { InstallationRow } from "@lictory/core/channels/slack/installation";

// Slack people and Lictory people (docs/internals/channels.md#people). A
// Slack person is a Lictory person only when Slack confirmed their email,
// a Lictory account with that address verified it too, and that account is
// a member of the organization. Everyone else (guests, people without an
// account, bots, Slackbot) is shown by name as "Name (Slack)" and has no
// Lictory identity or permission. Emails are compared, never stored.

const FRESH_MS = 24 * 60 * 60_000;

export type SlackPerson = {
  slackUserId: string;
  name: string;
  isBot: boolean;
  userId: string | null;
};

async function cached(
  db: Database | Tx,
  installationId: string,
  ids: readonly string[],
  freshOnly: boolean,
) {
  if (!ids.length) return [];
  return db
    .select()
    .from(s.slackUser)
    .where(
      and(
        eq(s.slackUser.installationId, installationId),
        inArray(s.slackUser.slackUserId, [...ids]),
        ...(freshOnly
          ? [gt(s.slackUser.fetchedAt, new Date(Date.now() - FRESH_MS))]
          : []),
      ),
    );
}

async function memberWithEmail(
  db: Database | Tx,
  organizationId: string,
  email: string,
) {
  const [row] = await db
    .select({ userId: s.user.id })
    .from(s.user)
    .innerJoin(
      s.member,
      and(
        eq(s.member.userId, s.user.id),
        eq(s.member.organizationId, organizationId),
      ),
    )
    .where(
      and(
        sql`lower(${s.user.email}) = ${email.toLowerCase()}`,
        eq(s.user.emailVerified, true),
      ),
    );
  return row?.userId ?? null;
}

/**
 * The Slack people with these ids, fetched from Slack when Lictory has not
 * seen them for a day. Network calls happen here, outside transactions.
 */
export async function slackPeople(
  db: Database,
  client: SlackClient,
  installation: InstallationRow,
  token: string,
  ids: readonly string[],
): Promise<Map<string, SlackPerson>> {
  const unique = [
    ...new Set(ids.filter((id) => /^[A-Z0-9]{2,20}$/.test(id))),
  ].slice(0, 50);
  const people = new Map<string, SlackPerson>();
  for (const row of await cached(db, installation.id, unique, true))
    people.set(row.slackUserId, {
      slackUserId: row.slackUserId,
      name: row.name,
      isBot: row.isBot,
      userId: row.userId,
    });
  for (const id of unique) {
    if (people.has(id)) continue;
    const info = await client.userInfo(token, id);
    const userId =
      info.confirmedEmail && !info.isBot && !info.deleted
        ? await memberWithEmail(
            db,
            installation.organizationId,
            info.confirmedEmail,
          )
        : null;
    const person = {
      slackUserId: id,
      name: info.name.slice(0, 120),
      isBot: info.isBot,
      userId,
    };
    await db
      .insert(s.slackUser)
      .values({
        organizationId: installation.organizationId,
        installationId: installation.id,
        slackUserId: id,
        name: person.name,
        isBot: person.isBot,
        userId,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [s.slackUser.installationId, s.slackUser.slackUserId],
        set: {
          name: person.name,
          isBot: person.isBot,
          userId,
          fetchedAt: new Date(),
        },
      });
    people.set(id, person);
  }
  return people;
}

/**
 * Slack ids of Lictory people, for mentions in mirrored messages: from
 * people Lictory has seen in Slack, else looked up by the person's verified
 * email (and remembered).
 */
export async function slackIdsOf(
  db: Database,
  client: SlackClient,
  installation: InstallationRow,
  token: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (!userIds.length) return ids;
  const known = await db
    .select({
      userId: s.slackUser.userId,
      slackUserId: s.slackUser.slackUserId,
    })
    .from(s.slackUser)
    .where(
      and(
        eq(s.slackUser.installationId, installation.id),
        inArray(s.slackUser.userId, [...userIds]),
      ),
    );
  for (const k of known) if (k.userId) ids.set(k.userId, k.slackUserId);
  const missing = userIds.filter((id) => !ids.has(id)).slice(0, 20);
  if (!missing.length) return ids;
  const people = await db
    .select({ id: s.user.id, email: s.user.email, name: s.user.name })
    .from(s.user)
    .innerJoin(
      s.member,
      and(
        eq(s.member.userId, s.user.id),
        eq(s.member.organizationId, installation.organizationId),
      ),
    )
    .where(and(inArray(s.user.id, missing), eq(s.user.emailVerified, true)));
  for (const person of people) {
    const slackUserId = await client.lookupByEmail(token, person.email);
    if (!slackUserId) continue;
    const info = await client.userInfo(token, slackUserId);
    // Both sides must agree on the address before a mention resolves.
    if (info.confirmedEmail !== person.email.toLowerCase() || info.isBot)
      continue;
    await db
      .insert(s.slackUser)
      .values({
        organizationId: installation.organizationId,
        installationId: installation.id,
        slackUserId,
        name: info.name.slice(0, 120),
        userId: person.id,
      })
      .onConflictDoUpdate({
        target: [s.slackUser.installationId, s.slackUser.slackUserId],
        set: {
          userId: person.id,
          name: info.name.slice(0, 120),
          fetchedAt: new Date(),
        },
      });
    ids.set(person.id, slackUserId);
  }
  return ids;
}
