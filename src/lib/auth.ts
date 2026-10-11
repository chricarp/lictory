import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";

import { db } from "~/db";
import { eq } from "drizzle-orm";
import { createInvitationEmail } from "~/emails/invitation-email";
import { sendEmail } from "~/lib/mailer";
import * as schema from "~/db/auth-schema";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { authSchemaOptions } from "~/lib/auth-schema-options";
import { authBaseUrl } from "~/lib/auth-base-url";
import {
  containsWhitespace,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "~/lib/password-policy";
import { deliverAuthEmail } from "~/lib/email";
import { seedOrganization } from "~/sync/server/organization";
import { trackServer } from "~/lib/analytics/server";
import { importProviderPhoto } from "~/profile/server";
import {
  microsoftEmailPolicy,
  validateMicrosoftAccountLink,
} from "~/lib/microsoft-auth";

const NEW_PASSWORD_FIELD: Record<string, string> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
  "/set-password": "newPassword",
};

const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);
const microsoftEnabled = Boolean(
  process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
);

export const auth = betterAuth({
  ...authSchemaOptions,
  appName: "Lictory",
  baseURL: authBaseUrl(process.env),
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await deliverAuthEmail({
        type: "password-reset",
        to: user.email,
        name: user.name,
        actionUrl: url,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await deliverAuthEmail({
        type: "verification",
        to: user.email,
        name: user.name,
        actionUrl: url,
      });
    },
  },
  user: {
    ...authSchemaOptions.user,
    changeEmail: { enabled: true },
    deleteUser: { enabled: true },
    validateUserInfo: validateMicrosoftAccountLink,
  },
  socialProviders: {
    ...(googleEnabled
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            prompt: "select_account" as const,
            overrideUserInfoOnSignIn: false,
          },
        }
      : {}),
    ...(microsoftEnabled
      ? {
          microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID!,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
            tenantId: process.env.MICROSOFT_TENANT_ID ?? "common",
            prompt: "select_account" as const,
            overrideUserInfoOnSignIn: false,
            ...microsoftEmailPolicy,
          },
        }
      : {}),
  },
  // Signing in with a provider whose email matches an existing account links
  // it to that account instead of creating a duplicate. Linking only happens
  // when the local email is verified (Better Auth's `requireLocalEmailVerified`
  // default), so nobody can pre-register someone else's address with a
  // password and inherit their Google sign-in. Google always verifies email
  // ownership, so it is trusted; Microsoft requires explicit linking from an
  // authenticated account. Explicit linking from account settings requires the
  // same email, and the last sign-in method cannot be removed.
  account: {
    accountLinking: {
      enabled: true,
      // Microsoft is allowed for explicit links; the user validation gate
      // rejects implicit links regardless of the provider's email claim.
      trustedProviders: ["google", "microsoft"],
      allowDifferentEmails: false,
      updateUserInfoOnLink: false,
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user, ctx) => {
          await importProviderPhoto(db, user);
          trackServer(
            user.id,
            "signed_up",
            { method: ctx?.path === "/sign-up/email" ? "email" : "social" },
            ctx?.headers,
            `signup:${user.id}`,
          );
        },
      },
    },
    session: {
      create: {
        after: async (session, ctx) => {
          trackServer(
            session.userId,
            "signed_in",
            {
              method:
                ctx?.path === "/sign-in/email"
                  ? "email"
                  : ctx?.path === "/verify-email"
                    ? "verification"
                    : "social",
            },
            ctx?.headers,
            `session:${session.id}`,
          );
          if (ctx?.path === "/verify-email")
            trackServer(
              session.userId,
              "email_verified",
              {},
              ctx.headers,
              `verified:${session.userId}`,
            );
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const events: Record<string, string> = {
        "/update-user": "account_profile_updated",
        "/change-email": "account_email_change_requested",
        "/change-password": "account_password_changed",
        "/revoke-sessions": "account_sessions_revoked",
        "/revoke-other-sessions": "account_sessions_revoked",
        "/revoke-session": "account_session_revoked",
        "/delete-user": "account_deleted",
        "/unlink-account": "social_account_unlinked",
        "/organization/leave": "organization_left",
        "/organization/update-member-role": "application_role_changed",
        "/organization/remove-member": "organization_member_removed",
        "/organization/cancel-invitation": "invitation_cancelled",
      };
      const event = events[ctx.path];
      const userId = ctx.context.session?.user.id;
      if (event && userId && !(ctx.context.returned instanceof APIError))
        trackServer(userId, event, {}, ctx.headers);
    }),
    // Better Auth enforces length; whitespace is our own rule. Only paths
    // that set a new password are checked, so sign-in keeps working for any
    // password that already exists.
    before: createAuthMiddleware(async (ctx) => {
      if (
        ["/update-user", "/sign-up/email"].includes(ctx.path) &&
        ctx.body &&
        Object.hasOwn(ctx.body as object, "image")
      ) {
        throw new APIError("BAD_REQUEST", {
          message: "Change your photo from Account settings.",
        });
      }
      const field = NEW_PASSWORD_FIELD[ctx.path];
      if (!field) return;
      const value = (ctx.body as Record<string, unknown> | undefined)?.[field];
      if (typeof value === "string" && containsWhitespace(value)) {
        throw new APIError("BAD_REQUEST", {
          code: "PASSWORD_CONTAINS_WHITESPACE",
          message: "Password can't contain spaces.",
        });
      }
    }),
  },
  onAPIError: {
    errorURL: "/auth-error",
  },
  plugins: [
    // Same schema as `authSchemaOptions`; hooks do not affect generation.
    organization({
      sendInvitationEmail: async ({
        id,
        email,
        organization,
        inviter,
        invitation,
      }) => {
        const [existing] = await db
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(eq(schema.user.email, email))
          .limit(1);
        const destination = `/app/invitation?id=${encodeURIComponent(id)}`;
        const actionUrl = new URL(
          existing ? "/sign-in" : "/sign-up",
          process.env.BETTER_AUTH_URL,
        );
        actionUrl.searchParams.set("callbackUrl", destination);
        const rendered = createInvitationEmail({
          to: email,
          inviterName: inviter.user.name,
          organizationName: organization.name,
          existingUser: Boolean(existing),
          actionUrl: actionUrl.toString(),
          expiresAt: invitation.expiresAt,
        });
        await sendEmail({
          to: email,
          ...rendered,
          idempotencyKey: `lictory-invitation-${id}-${invitation.expiresAt.getTime()}`,
        });
      },
      organizationHooks: {
        // Every organization starts with the default work item types; its
        // first project (with disciplines and workflow) comes from onboarding.
        afterCreateOrganization: async ({ organization, user }) => {
          await seedOrganization(db, organization.id);
          trackServer(
            user.id,
            "organization_created",
            { organization_id: organization.id },
            undefined,
            organization.id,
          );
        },
        afterUpdateOrganization: async ({ organization, user }) => {
          if (organization)
            trackServer(user.id, "organization_updated", {
              organization_id: organization.id,
            });
        },
        afterCreateInvitation: async ({
          invitation,
          inviter,
          organization,
        }) => {
          trackServer(
            inviter.id,
            "invitation_created",
            { organization_id: organization.id },
            undefined,
            invitation.id,
          );
        },
        afterAcceptInvitation: async ({ invitation, user, organization }) => {
          trackServer(
            user.id,
            "invitation_accepted",
            { organization_id: organization.id },
            undefined,
            invitation.id,
          );
        },
      },
    }),
    nextCookies(),
  ],
});

export const authProviders = {
  google: googleEnabled,
  microsoft: microsoftEnabled,
};
