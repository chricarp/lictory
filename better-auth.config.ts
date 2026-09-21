import { betterAuth } from "better-auth/minimal";

import { authSchemaOptions } from "./src/lib/auth-schema-options";

// Schema generation does not need Next.js, email delivery, or a database connection.
export const auth = betterAuth(authSchemaOptions);
