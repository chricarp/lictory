import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "@lictory/core/db/schema";
import {
  ACCOUNT_DEACTIVATED,
  accountCreationProblem,
  accountOrigin,
  type AccountOrigin,
  type InstancePolicy,
} from "@lictory/core/lib/instance-policy";
import {
  containsWhitespace,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@lictory/core/lib/password-policy";

type Database = PostgresJsDatabase<typeof s>;

// The Better Auth side of instance policy: the account creation gate, the
// deactivation gate and server-only endpoints the admin console and the
// server CLI use to provision accounts. Kept apart from lib/auth.ts so tests
// can exercise the gates against a database without the full auth instance.

export async function hasPendingInvitation(
  db: Database,
  email: string,
  now = new Date(),
) {
  const [row] = await db
    .select({ id: s.invitation.id })
    .from(s.invitation)
    .where(
      and(
        sql`lower(${s.invitation.email}) = ${email.trim().toLowerCase()}`,
        eq(s.invitation.status, "pending"),
        gt(s.invitation.expiresAt, now),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function accountCreationDecision(
  db: Database,
  policy: InstancePolicy,
  origin: AccountOrigin,
  email: string,
) {
  // The invitation lookup only matters for self-service sign-up by invitation.
  const invited =
    origin === "self-service" && policy.signUpMode === "invite"
      ? await hasPendingInvitation(db, email)
      : false;
  return accountCreationProblem(policy, { origin, email, invited });
}

type ValidateUserInfo = NonNullable<
  NonNullable<BetterAuthOptions["user"]>["validateUserInfo"]
>;

// Every new account, whatever created it (password sign-up, Google,
// Microsoft, the company identity provider, an administrator), passes here
// before its row is written. Linking and returning sign-ins are not account
// creation and are left to the other gates.
export function accountCreationGate(
  db: Database,
  policy: InstancePolicy,
  identityProviderId: string,
): ValidateUserInfo {
  return async ({ user, source }) => {
    if (source.action !== "create-user") return;
    const problem = await accountCreationDecision(
      db,
      policy,
      accountOrigin(source, identityProviderId),
      typeof user.email === "string" ? user.email : "",
    );
    return problem
      ? { error: problem.code, errorDescription: problem.message }
      : undefined;
  };
}

// Password sign-up answers a refused creation with Better Auth's generic
// "check your email" response (it hides which emails exist), which would
// leave the person waiting for an email that never comes. The same decision
// is taken first, with its own message. It reveals nothing about accounts.
export async function assertSelfServiceSignUp(
  db: Database,
  policy: InstancePolicy,
  email: unknown,
) {
  if (typeof email !== "string") return;
  const problem = await accountCreationDecision(
    db,
    policy,
    "self-service",
    email,
  );
  if (problem)
    throw new APIError("FORBIDDEN", {
      code: problem.code,
      message: problem.message,
    });
}

export async function isDeactivated(db: Database, userId: string) {
  const [row] = await db
    .select({ deactivatedAt: s.user.deactivatedAt })
    .from(s.user)
    .where(eq(s.user.id, userId));
  return Boolean(row?.deactivatedAt);
}

// No new session for a deactivated account, however it signs in.
export async function assertSessionAllowed(db: Database, userId: string) {
  if (await isDeactivated(db, userId))
    throw new APIError("FORBIDDEN", { ...ACCOUNT_DEACTIVATED });
}

function passwordProblem(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (containsWhitespace(password)) return "Password can't contain spaces.";
  return null;
}

const provisionBody = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(320),
  password: z.string().optional(),
  instanceAdmin: z.boolean().default(false),
});

const passwordBody = z.object({
  userId: z.string().min(1),
  password: z.string(),
});

// Server-only endpoints (never on the HTTP router): callers authorize first.
// Running inside Better Auth gives the creation gate its endpoint context,
// with the `admin` provisioning source.
export function instanceAdministration() {
  return {
    id: "lictory-instance-administration",
    endpoints: {
      provisionUser: createAuthEndpoint.serverOnly(
        { method: "POST", body: provisionBody },
        async (ctx) => {
          const { name, password, instanceAdmin } = ctx.body;
          const email = ctx.body.email.toLowerCase();
          if (password !== undefined) {
            const problem = passwordProblem(password);
            if (problem)
              throw new APIError("BAD_REQUEST", {
                code: "INVALID_PASSWORD",
                message: problem,
              });
          }
          if (await ctx.context.internalAdapter.findUserByEmail(email))
            throw new APIError("BAD_REQUEST", {
              code: "USER_ALREADY_EXISTS",
              message: "An account with this email already exists.",
            });
          // Administrators vouch for the address, so it counts as verified.
          const user = await ctx.context.internalAdapter.createUser(
            { email, name, emailVerified: true, instanceAdmin },
            { method: "admin" },
          );
          if (password !== undefined)
            await ctx.context.internalAdapter.linkAccount({
              providerId: "credential",
              accountId: user.id,
              userId: user.id,
              password: await ctx.context.password.hash(password),
            });
          return ctx.json({
            user: { id: user.id, name: user.name, email: user.email },
          });
        },
      ),
      // Sets a password (account recovery) and ends the person's sessions.
      setUserPassword: createAuthEndpoint.serverOnly(
        { method: "POST", body: passwordBody },
        async (ctx) => {
          const { userId, password } = ctx.body;
          const problem = passwordProblem(password);
          if (problem)
            throw new APIError("BAD_REQUEST", {
              code: "INVALID_PASSWORD",
              message: problem,
            });
          const hash = await ctx.context.password.hash(password);
          if (await ctx.context.internalAdapter.findCredentialAccount(userId))
            await ctx.context.internalAdapter.updatePassword(userId, hash);
          else
            await ctx.context.internalAdapter.createAccount({
              userId,
              providerId: "credential",
              accountId: userId,
              password: hash,
            });
          await ctx.context.internalAdapter.deleteUserSessions(userId);
          return ctx.json({ ok: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
