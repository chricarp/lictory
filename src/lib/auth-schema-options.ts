import type { BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins";

// Shared by runtime auth and the schema generator. Keep schema-affecting options here.
export const authSchemaOptions = {
  plugins: [organization()],
} satisfies BetterAuthOptions;
