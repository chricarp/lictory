import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import * as s from "../db/schema";
import {
  CapabilityError,
  defineCapability,
  id,
  webOnly,
  type AnyCapability,
  type Database,
} from "./core";

// Personal access tokens for external agents (MCP clients). A token is a
// bearer credential for its owner: it grants exactly the owner's current
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
  access: "read" | "write";
};

export async function authenticateAccessToken(
  db: Database,
  secret: string,
  now = new Date(),
): Promise<AuthenticatedToken | null> {
  if (!secret.startsWith(PREFIX) || secret.length > 200) return null;
  const digest = hash(secret);
  const [row] = await db
    .select()
    .from(s.accessToken)
    .where(eq(s.accessToken.tokenHash, digest));
  if (
    !row ||
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

const listAccessTokens = defineCapability({
  name: "listAccessTokens",
  title: "List access tokens",
  description: "Your personal access tokens for agents.",
  kind: "query",
  surfaces: webOnly,
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
    if ((count?.active ?? 0) >= MAX_ACTIVE_TOKENS)
      throw new CapabilityError(
        "validation",
        `You can have at most ${MAX_ACTIVE_TOKENS} active tokens. Revoke one you no longer use.`,
      );
    const secret = PREFIX + randomBytes(32).toString("base64url");
    const [row] = await ctx.db
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
  destructive: true,
  idempotent: true,
  input: z.object({ tokenId: id }),
  async run(ctx, input) {
    const [row] = await ctx.db
      .update(s.accessToken)
      .set({ revokedAt: sql`coalesce(${s.accessToken.revokedAt}, now())` })
      .where(
        and(
          eq(s.accessToken.id, input.tokenId),
          eq(s.accessToken.userId, ctx.principal.userId),
        ),
      )
      .returning();
    if (!row)
      throw new CapabilityError("unavailable", "This token does not exist.");
    ctx.effects.track("access_token_revoked", {});
    return { token: summary(row) };
  },
});

export const accessTokenCapabilities = [
  listAccessTokens,
  createAccessToken,
  revokeAccessToken,
] as AnyCapability[];
