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
    },
  },
  // Runtime auth configures these plugins further; options that change the
  // schema must stay identical in both places.
  plugins: [organization(), twoFactor(), passkey()],
} satisfies BetterAuthOptions;
