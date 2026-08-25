import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

import type { Env } from "../../bindings";
import * as schema from "./schema";

export type Database = DrizzleD1Database<typeof schema>;

/** Creates a request-scoped typed client over the Worker's D1 binding. */
export function database(env: Pick<Env, "DB">): Database {
  return drizzle(env.DB, { schema });
}
