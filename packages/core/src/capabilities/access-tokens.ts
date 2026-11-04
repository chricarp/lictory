import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "@lictory/core/db/schema";
import {
  CapabilityError,
  defineCapability,
  id,
  webOnly,
  type AnyCapability,
  type Database,
} from "@lictory/core/capabilities/core";
import { recordAccountAuditEvent } from "@lictory/core/domain/audit";

// Personal access tokens for external agents (MCP clients). A token is one
// named agent acting for its owner: its name and id identify the agent in
// activity history. It is a bearer credential for its owner: it grants exactly the owner's current
// permissions, never more, and `read` tokens only reach queries. Tokens are
// created, listed and revoked by the signed-in person in the browser; agents
// cannot manage credentials.

const PREFIX = "lct_";
const MAX_ACTIVE_TOKENS = 25;
export const tokenAccess = ["read", "write"] as const;

const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");

export type AuthenticatedToken = {
  tokenId: string;
  userId: string;
  // The agent this token identifies in activity history.
  name: string;
  access: "read" | "write";
};

export async function authenticateAccessToken(
  db: Database,
  secret: string,
  now = new Date(),
): Promise<AuthenticatedToken | null> {
  if (!secret.startsWith(PREFIX) || secret.length > 200) return null;
  const digest = hash(secret);
  const [found] = await db
    .select({
      token: s.accessToken,
      deactivatedAt: s.user.deactivatedAt,
    })
    .from(s.accessToken)
    .innerJoin(s.user, eq(s.user.id, s.accessToken.userId))
    .where(eq(s.accessToken.tokenHash, digest));
  const row = found?.token;
  if (
    !row ||
    // A deactivated account's tokens stop working until it is reactivated.
    found.deactivatedAt ||
    // The lookup is by hash; compare again in constant time regardless.
    !timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(digest)) ||
    row.revokedAt ||
    (row.expiresAt && row.expiresAt <= now)
  )
    return null;
  // Coarse last-use tracking: at most one write a minute per token.
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000)
    await db
      .update(s.accessToken)
      .set({ lastUsedAt: now })
      .where(eq(s.accessToken.id, row.id));
  return {
    tokenId: row.id,
    userId: row.userId,
    name: row.name,
    access: row.scope === "write" ? "write" : "read",
  };
}

function summary(row: typeof s.accessToken.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    access: row.scope as "read" | "write",
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
export type AccessTokenSummary = ReturnType<typeof summary>;

const tokenTarget = (row: typeof s.accessToken.$inferSelect) => ({
  type: "access_token",
  id: row.id,
  label: row.name,
});

const listAccessTokens = defineCapability({
  name: "listAccessTokens",
  title: "List access tokens",
  description: "Your personal access tokens for agents.",
  kind: "query",
  surfaces: webOnly,
  humanOnly: {
    reason: "credentials",
    where: "Account settings → Integrations → AI agents (MCP)",
  },
  input: z.object({}),
  async run(ctx) {
    const rows = await ctx.db
      .select()
      .from(s.accessToken)
      .where(eq(s.accessToken.userId, ctx.principal.userId))
      .orderBy(desc(s.accessToken.createdAt));
    return { tokens: rows.map(summary) };
  },
});

const createAccessToken = defineCapability({
  name: "createAccessToken",
  title: "Create access token",
  description:
    "Create a personal access token for an agent. The secret is returned once.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: {
    reason: "credentials",
    where: "Account settings → Integrations → AI agents (MCP)",
  },
  input: z.object({
    name: z.string().trim().min(1, "Name the token.").max(80),
    access: z.enum(tokenAccess),
    expiresInDays: z
      .union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)])
      .nullable(),
  }),
  async run(ctx, input) {
    const userId = ctx.principal.userId;
    const [count] = await ctx.db
      .select({ active: sql<number>`count(*)::int` })
      .from(s.accessToken)
      .where(
        and(
          eq(s.accessToken.userId, userId),
          isNull(s.accessToken.revokedAt),
          sql`(${s.accessToken.expiresAt} is null or ${s.accessToken.expiresAt} > now())`,
        ),
      );
    // A token is one named agent in activity history; two active agents of
    // the same person with one name could not be told apart.
    const [duplicate] = await ctx.db
      .select({ id: s.accessToken.id })
      .from(s.accessToken)
      .where(
        and(
          eq(s.accessToken.userId, userId),
          sql`lower(${s.accessToken.name}) = lower(${input.name})`,
          isNull(s.accessToken.revokedAt),
          sql`(${s.accessToken.expiresAt} is null or ${s.accessToken.expiresAt} > now())`,
        ),
      )
      .limit(1);
    if (duplicate)
      throw new CapabilityError(
        "validation",
        `An active token is already named “${input.name}”. Give each agent its own name so its work can be told apart.`,
      );
    if ((count?.active ?? 0) >= MAX_ACTIVE_TOKENS)
      throw new CapabilityError(
        "validation",
        `You can have at most ${MAX_ACTIVE_TOKENS} active tokens. Revoke one you no longer use.`,
      );
    const secret = PREFIX + randomBytes(32).toString("base64url");
    // A token can act in every organization its owner belongs to, so each of
    // them records it, in the same transaction as the token.
    const row = await ctx.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(s.accessToken)
        .values({
          userId,
          name: input.name,
          scope: input.access,
          prefix: secret.slice(0, PREFIX.length + 6),
          tokenHash: hash(secret),
          expiresAt: input.expiresInDays
            ? new Date(Date.now() + input.expiresInDays * 86_400_000)
            : null,
        })
        .returning();
      await recordAccountAuditEvent(tx, userId, {
        actor: { id: userId },
        action: "access_token.created",
        target: tokenTarget(created!),
        detail: {
          access: created!.scope,
          prefix: created!.prefix,
          expiresAt: created!.expiresAt?.toISOString() ?? null,
        },
      });
      return created;
    });
    ctx.effects.track("access_token_created", { access: input.access });
    return { token: summary(row!), secret };
  },
});

const revokeAccessToken = defineCapability({
  name: "revokeAccessToken",
  title: "Revoke access token",
  description: "Revoke a personal access token immediately.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: {
    reason: "credentials",
    where: "Account settings → Integrations → AI agents (MCP)",
  },
  destructive: true,
  idempotent: true,
  input: z.object({ tokenId: id }),
  async run(ctx, input) {
    const userId = ctx.principal.userId;
    const owned = and(
      eq(s.accessToken.id, input.tokenId),
      eq(s.accessToken.userId, userId),
    );
    const row = await ctx.db.transaction(async (tx) => {
      const [revoked] = await tx
        .update(s.accessToken)
        .set({ revokedAt: sql`now()` })
        .where(and(owned, isNull(s.accessToken.revokedAt)))
        .returning();
      // Revoking again changes nothing and records nothing.
      if (!revoked)
        return (await tx.select().from(s.accessToken).where(owned))[0];
      await recordAccountAuditEvent(tx, userId, {
        actor: { id: userId },
        action: "access_token.revoked",
        target: tokenTarget(revoked),
        detail: { access: revoked.scope, prefix: revoked.prefix },
      });
      return revoked;
    });
    if (!row)
      throw new CapabilityError("not_found", "This token does not exist.");
    ctx.effects.track("access_token_revoked", {});
    return { token: summary(row) };
  },
});

export const accessTokenCapabilities = [
  listAccessTokens,
  createAccessToken,
  revokeAccessToken,
] as AnyCapability[];
