import { spawn } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
const adminUrl =
  process.env.SCHEMA_TEST_DATABASE_URL ??
  "postgresql://lictory:lictory@localhost:5432/postgres";
const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
const name = `lictory_e2e_${crypto.randomUUID().replaceAll("-", "")}`;
const url = new URL(adminUrl);
url.pathname = `/${name}`;
await admin`CREATE DATABASE ${admin(name)}`;
try {
  const client = postgres(url.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  await client.end();
  const child = spawn("bunx", ["playwright", "test"], {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url.toString(),
      DATABASE_URL_UNPOOLED: url.toString(),
      BETTER_AUTH_URL: "http://localhost:3001",
      BETTER_AUTH_SECRET:
        "e2e-local-only-secret-with-at-least-thirty-two-characters",
      NEXT_DIST_DIR: ".next-e2e",
      RESEND_API_KEY: "",
    },
  });
  process.exitCode = await new Promise<number>((resolve) =>
    child.on("exit", (code) => resolve(code ?? 1)),
  );
} finally {
  await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  await admin.end();
}
