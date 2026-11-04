import type { BetterAuthOptions } from "better-auth";
import { passkey } from "@better-auth/passkey";
import { organization, twoFactor } from "better-auth/plugins";

// Shared by runtime auth and the schema generator. Keep schema-affecting options here.
export const authSchemaOptions = {
  user: {
    additionalFields: {
      // Platform-wide unique, lowercase handle (see `~/lib/handles`). Null
      // until the person chooses one; the app requires it before any
      // workspace access. Only settable through the handle endpoint, which
      // validates it, never through Better Auth's generic user update.
      handle: { type: "string", required: false, unique: true, input: false },
      // "system" | "light" | "dark" (see `~/lib/appearance`). Set only through
      // the appearance endpoint, which validates the value.
      appearance: {
        type: "string",
        required: true,
        defaultValue: "system",
        input: false,
      },
      // One of THEMES (see `~/lib/appearance`). Set only through the
      // appearance endpoint, which validates the value.
      theme: {
        type: "string",
        required: true,
        defaultValue: "lictory",
        input: false,
      },
      // Instance administrator: manages accounts, organizations and access
      // policy of the installation (see `~/lib/instance-policy`). Separate
      // from organization roles. Set only by the admin console or the server
      // CLI, never by the person.
      instanceAdmin: {
        type: "boolean",
        required: true,
        defaultValue: false,
        input: false,
      },
      // Set when an instance administrator deactivates the account: no new
      // sessions or access tokens work until it is reactivated. Nothing else
      // about the account changes, so reactivating restores it.
      deactivatedAt: { type: "date", required: false, input: false },
      // Set when the person deletes their account. The row stays as a
      // tombstone (id and display name) because history refers to it; its
      // credentials, contact details and memberships are gone, and it is
      // deactivated for good. See `~/domain/account-deletion`.
      deletedAt: { type: "date", required: false, input: false },
    },
  },
  // Counters live in PostgreSQL so every API replica shares them and they
  // survive deploys. Better Auth's defaults (on in production only, 100
  // requests per 10 s, 3 per 10 s for sign-in and sign-up, 3 per minute for
  // reset and verification email) and its pruning of expired rows are kept.
  // See "Scaling" in docs/operations/deployment.md.
  rateLimit: { storage: "database" },
  // Runtime auth configures these plugins further; options that change the
  // schema must stay identical in both places.
  plugins: [organization(), twoFactor(), passkey()],
} satisfies BetterAuthOptions;
