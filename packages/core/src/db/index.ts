import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@lictory/core/db/schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis as unknown as {
  sqlClient: ReturnType<typeof postgres> | undefined;
};

const sqlClient =
  globalForDb.sqlClient ??
  postgres(databaseUrl, {
    max: process.env.NODE_ENV === "production" ? 10 : 1,
    onnotice: () => undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.sqlClient = sqlClient;
}

type Sql = postgres.Sql | postgres.TransactionSql;

// Drizzle sends every query through `sql.unsafe`, which postgres.js runs as an
// unnamed statement. An unnamed statement with parameters costs an extra round
// trip to describe it and stops postgres.js from pipelining queries issued
// together. Named (protocol-level) prepared statements are described once per
// connection. A transaction pooler in front of DATABASE_URL must support them
// (PgBouncer does with `max_prepared_statements` enabled).
function preparedStatements<T extends Sql>(sql: T): T {
  return new Proxy(sql, {
    get(target, property, receiver) {
      if (property === "unsafe")
        return (
          query: string,
          args?: postgres.ParameterOrJSON<never>[],
          options?: postgres.UnsafeQueryOptions,
        ) =>
          Array.isArray(args)
            ? target.unsafe(query, args, { prepare: true, ...options })
            : target.unsafe(query, args, options);
      if (property === "begin" || property === "savepoint")
        return (...args: unknown[]) => {
          const scope = args.pop() as (sql: postgres.TransactionSql) => unknown;
          return (
            Reflect.get(target, property, target) as (
              ...args: unknown[]
            ) => unknown
          )(...args, (sql: postgres.TransactionSql) =>
            scope(preparedStatements(sql)),
          );
        };
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

export const db = drizzle(preparedStatements(sqlClient), { schema });

// Graceful shutdown: waits briefly for running queries, then closes the pool.
export async function closeDatabase(timeoutSeconds = 5) {
  await sqlClient.end({ timeout: timeoutSeconds });
}
