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
  const child = spawn(
    "bunx",
    ["playwright", "test", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        DATABASE_URL_UNPOOLED: url.toString(),
        BETTER_AUTH_URL: "http://localhost:3001",
        BETTER_AUTH_SECRET:
          "e2e-local-only-secret-with-at-least-thirty-two-characters",
        // Never inherit a developer's live OAuth proxy or its shared secret.
        OAUTH_PROXY_URL: "",
        OAUTH_PROXY_SECRET: "",
        OAUTH_PROXY_TRUSTED_ORIGINS: "",
        // Deployment notices/source must not inherit the developer's cloud identity.
        LICTORY_LEGAL_TEMPLATE: "self-hosted",
        LICTORY_LEGAL_NAME: "Test installation operator",
        LICTORY_LEGAL_ADDRESS: "",
        LICTORY_LEGAL_EMAIL: "",
        LICTORY_SOURCE_URL: "https://example.org/lictory/test-source.tar.gz",
        NEXT_DIST_DIR: ".next-e2e",
        RESEND_API_KEY: "",
        // Placeholder credentials enable social flows up to the provider
        // redirect; tests intercept Google and Microsoft authorization pages.
        GOOGLE_CLIENT_ID: "e2e-google-client-id",
        GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
        MICROSOFT_CLIENT_ID: "00000000-0000-4000-8000-000000000042",
        MICROSOFT_CLIENT_SECRET: "e2e-microsoft-client-secret",
        MICROSOFT_TENANT_ID: "common",
      },
    },
  );
  process.exitCode = await new Promise<number>((resolve) =>
    child.on("exit", (code) => resolve(code ?? 1)),
  );
} finally {
  await admin`DROP DATABASE ${admin(name)} WITH (FORCE)`;
  await admin.end();
}
