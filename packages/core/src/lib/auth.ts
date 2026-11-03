import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { organization, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";

import { db } from "@lictory/core/db";
import { eq } from "drizzle-orm";
import { createInvitationEmail } from "@lictory/core/emails/invitation-email";
import { sendEmail } from "@lictory/core/lib/mailer";
import * as schema from "@lictory/core/db/auth-schema";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";

import { authSchemaOptions } from "@lictory/core/lib/auth-schema-options";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { oauthProxyConfig } from "@lictory/core/lib/oauth-proxy";
import {
  normalizeOrganizationHandle,
  organizationHandleProblem,
} from "@lictory/core/lib/organization-handles";
import {
  containsWhitespace,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "@lictory/core/lib/password-policy";
import { deliverAuthEmail } from "@lictory/core/lib/email";
import { seedOrganization } from "@lictory/core/domain/organization";
import {
  organizationsOf,
  refreshDirectories,
} from "@lictory/core/domain/projections";
import { trackServer } from "@lictory/core/lib/analytics/server";
import {
  recordAccountDeleted,
  recordAuthAudit,
} from "@lictory/core/lib/auth-audit";
import {
  auditedAuthPaths,
  rememberPreviousRole,
} from "@lictory/core/lib/auth-audit-plan";
import { importProviderPhoto } from "@lictory/core/profile/server";
import {
  microsoftEmailPolicy,
  validateMicrosoftAccountLink,
} from "@lictory/core/lib/microsoft-auth";
import {
  OIDC_PROVIDER_ID,
  oidcPlugins,
  oidcSettings,
  passwordFlowClosed,
  passwordLoginEnabled,
  validateOidcAccountLink,
} from "@lictory/core/lib/sso";

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
const oauthProxy = oauthProxyConfig(process.env);
const oidc = oidcSettings(process.env);
const passwordLogin = passwordLoginEnabled(
  process.env,
  Boolean(oidc) || googleEnabled || microsoftEnabled,
);

// Directories list each member's name, email, photo, handle and application
// role, and organization profiles carry names and slugs. Better Auth commits
// these writes itself (the adapter runs without transactions), so the
// projections are refreshed right after, each under its organization lock.
const refreshOrganizations = (organizationIds: Iterable<string>) =>
  refreshDirectories(db, organizationIds);
const refreshUserOrganizations = async (userId: string) =>
  refreshOrganizations(await organizationsOf(db, userId));
// Memberships of users being deleted, captured before the cascade removes them.
const deletedMemberships = new Map<string, string[]>();

export const auth = betterAuth({
  ...authSchemaOptions,
  appName: "Lictory",
  baseURL: platformUrl(),
  trustedOrigins: [platformUrl(), ...oauthProxy.trustedOrigins],
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: passwordLogin,
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
    validateUserInfo: async (info, context) =>
      (await validateMicrosoftAccountLink(info, context)) ??
      validateOidcAccountLink(info, context),
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
  // authenticated account. The company OIDC provider links implicitly only when
  // its `email_verified` claim is true, explicitly like Microsoft (lib/sso.ts).
  // Explicit linking from account settings requires the same email, and the
  // last sign-in method cannot be removed.
  account: {
    accountLinking: {
      enabled: true,
      // Microsoft and OIDC are allowed for explicit links; the user validation
      // gates reject implicit links (OIDC: unless the provider verified the
      // email).
      trustedProviders: ["google", "microsoft", OIDC_PROVIDER_ID],
      allowDifferentEmails: false,
      updateUserInfoOnLink: false,
    },
  },
  databaseHooks: {
    user: {
      update: {
        after: async (user) => {
          await refreshUserOrganizations(user.id);
        },
      },
      delete: {
        before: async (user) => {
          deletedMemberships.set(user.id, await organizationsOf(db, user.id));
        },
        after: async (user) => {
          const organizationIds = deletedMemberships.get(user.id) ?? [];
          deletedMemberships.delete(user.id);
          await recordAccountDeleted(user, organizationIds);
          await refreshOrganizations(organizationIds);
        },
      },
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
                    : ctx?.path?.startsWith("/two-factor/")
                      ? "two_factor"
                      : ctx?.path === "/passkey/verify-authentication"
                        ? "passkey"
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
        "/two-factor/disable": "two_factor_disabled",
        "/two-factor/generate-backup-codes":
          "two_factor_backup_codes_regenerated",
        "/passkey/verify-registration": "passkey_added",
        "/passkey/delete-passkey": "passkey_removed",
      };
      const event = events[ctx.path];
      const userId = ctx.context.session?.user.id;
      // Leaving has no organization hook.
      const left = (ctx.body as { organizationId?: unknown } | undefined)
        ?.organizationId;
      if (
        ctx.path === "/organization/leave" &&
        typeof left === "string" &&
        !(ctx.context.returned instanceof APIError)
      )
        await refreshOrganizations([left]);
      if (event && userId && !(ctx.context.returned instanceof APIError))
        trackServer(userId, event, {}, ctx.headers);
      // Membership changes are audited whether or not analytics is enabled.
      if (
        auditedAuthPaths.has(ctx.path) &&
        !(ctx.context.returned instanceof APIError)
      ) {
        const session =
          ctx.context.session ??
          (await getSessionFromCtx(ctx).catch(() => null));
        await recordAuthAudit(
          ctx.path,
          ctx.body,
          ctx.context.returned,
          session ? { id: session.user.id } : null,
        );
      }
    }),
    // Better Auth enforces length; whitespace is our own rule. Only paths
    // that set a new password are checked, so sign-in keeps working for any
    // password that already exists.
    before: createAuthMiddleware(async (ctx) => {
      passwordFlowClosed(ctx.path, passwordLogin);
      // Normalize before Better Auth's uniqueness checks, including direct API
      // callers. Name-only updates leave legacy generated handles untouched.
      const body = ctx.body as
        { slug?: unknown; data?: { slug?: unknown } } | undefined;
      const organizationData =
        ctx.path === "/organization/update"
          ? body?.data
          : ["/organization/create", "/organization/check-slug"].includes(
                ctx.path,
              )
            ? body
            : undefined;
      if (organizationData && typeof organizationData.slug === "string") {
        const slug = normalizeOrganizationHandle(organizationData.slug);
        const problem = organizationHandleProblem(slug);
        if (problem)
          throw new APIError("BAD_REQUEST", {
            code: "INVALID_ORGANIZATION_HANDLE",
            message: problem,
          });
        organizationData.slug = slug;
      }
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
    ...oauthProxy.plugins,
    // Same schema as `authSchemaOptions`. Authenticator apps (TOTP) with
    // backup codes; email codes stay off. Enabling requires verifying a code
    // first, and only password sign-ins ask for the second factor (social
    // providers apply their own). See docs/internals/two-factor-authentication.md.
    twoFactor({
      issuer: "Lictory",
      // People who sign in only with Google or Microsoft can still enroll
      // (and meet an organization's requirement); accounts with a password
      // always confirm it.
      allowPasswordless: true,
    }),
    // WebAuthn is bound to the platform's one public origin, never to the
    // request's Host or Origin headers. SSO-only installations leave passkeys
    // off: the company identity provider decides who may sign in, and a
    // passkey sign-in would go around it. The table stays in the schema.
    ...(passwordLogin
      ? [
          passkey({
            rpID: new URL(platformUrl()).hostname,
            rpName: "Lictory",
            origin: platformUrl(),
          }),
        ]
      : []),
    // Company identity provider (OpenID Connect), when configured.
    ...oidcPlugins(oidc),
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
        const destination = `/invitation?id=${encodeURIComponent(id)}`;
        const actionUrl = new URL(
          existing ? "/sign-in" : "/sign-up",
          platformUrl(),
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
          if (organization) {
            await refreshOrganizations([organization.id]);
            trackServer(user.id, "organization_updated", {
              organization_id: organization.id,
            });
          }
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
        afterAddMember: async ({ organization }) => {
          await refreshOrganizations([organization.id]);
        },
        afterRemoveMember: async ({ organization }) => {
          await refreshOrganizations([organization.id]);
        },
        afterUpdateMemberRole: async ({
          organization,
          member,
          previousRole,
        }) => {
          rememberPreviousRole(member.id, previousRole);
          await refreshOrganizations([organization.id]);
        },
        afterAcceptInvitation: async ({ invitation, user, organization }) => {
          await refreshOrganizations([organization.id]);
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
  ],
});

export const authProviders = {
  google: googleEnabled,
  microsoft: microsoftEnabled,
  oidc: Boolean(oidc),
};

// How people sign in on this installation, for the sign-in pages.
export const signInOptions = {
  password: passwordLogin,
  ssoName: oidc?.displayName ?? null,
};
