import type { Schema } from "@lictory/zero/schema";

// Derived on the server from the verified Better Auth session. Never trust a
// client-supplied context for authorization: the query and mutate endpoints
// rebuild it from the forwarded cookie.
export type ZeroContext = { userID: string };

declare module "@rocicorp/zero" {
  interface DefaultTypes {
    schema: Schema;
    context: ZeroContext;
  }
}
