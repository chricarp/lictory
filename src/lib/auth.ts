import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";

import { db } from "~/db";
import * as schema from "~/db/auth-schema";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { authSchemaOptions } from "~/lib/auth-schema-options";
import {
  containsWhitespace,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "~/lib/password-policy";
import { deliverAuthEmail } from "~/lib/email";
import { seedDefaultRoles } from "~/sync/server/roles";

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
  baseURL: process.env.BETTER_AUTH_URL,
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
      deliverAuthEmail({
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
      deliverAuthEmail({
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
  },
  socialProviders: {
    ...(googleEnabled
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
            prompt: "select_account" as const,
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
          },
        }
      : {}),
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "microsoft"],
    },
  },
  hooks: {
    // Better Auth enforces length; whitespace is our own rule. Only paths
    // that set a new password are checked, so sign-in keeps working for any
    // password that already exists.
    before: createAuthMiddleware(async (ctx) => {
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
      organizationHooks: {
        // Every organization starts with Product, Engineering and QA roles and
        // its creator (the first administrator) in Product.
        afterCreateOrganization: async ({ organization, user }) => {
          await seedDefaultRoles(db, organization.id, user.id);
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
