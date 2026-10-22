import { betterAuth } from "better-auth/minimal";

import { authSchemaOptions } from "@lictory/core/lib/auth-schema-options";

// Schema generation does not need Next.js, email delivery, or a database connection.
export const auth = betterAuth(authSchemaOptions);
