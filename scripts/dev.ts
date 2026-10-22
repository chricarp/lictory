// Starts the whole platform for development on one origin:
//   http://localhost:3000  SPA (Vite, proxies /api, /relay and /zero)
//   http://localhost:3002  API        http://localhost:4848  zero-cache
//   http://localhost:3100  website    worker (no port)
// Usage: bun run dev   (reads .env; run `bun run db:migrate` first)
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";

// Empty variables count as unset.
const or = (value: string | undefined, fallback: string) =>
  value?.trim() ? value : fallback;
const env: Record<string, string | undefined> = {
  ...process.env,
  PLATFORM_URL: or(process.env.PLATFORM_URL, "http://localhost:3000"),
  SITE_URL: or(process.env.SITE_URL, "http://localhost:3100"),
  VITE_SITE_URL: or(process.env.VITE_SITE_URL, "http://localhost:3100"),
  NEXT_PUBLIC_PLATFORM_URL: or(
    process.env.NEXT_PUBLIC_PLATFORM_URL,
    "http://localhost:3000",
  ),
};
const database = or(env.DATABASE_URL_UNPOOLED, env.DATABASE_URL ?? "");
if (!database) throw new Error("Set DATABASE_URL in .env.");
mkdirSync(".zero", { recursive: true });

const services: [string, string, string[], NodeJS.ProcessEnv][] = [
  ["api", "bun", ["run", "--filter", "@lictory/api", "dev"], env],
  ["worker", "bun", ["run", "--filter", "@lictory/worker", "dev"], env],
  [
    "zero",
    "node_modules/.bin/zero-cache",
    [],
    {
      ...env,
      ZERO_UPSTREAM_DB: database,
      ZERO_REPLICA_FILE: ".zero/replica.db",
      ZERO_APP_PUBLICATIONS: "lictory_zero",
      ZERO_QUERY_URL: "http://localhost:3002/api/zero/query",
      ZERO_MUTATE_URL: "http://localhost:3002/api/zero/mutate",
      ZERO_QUERY_FORWARD_COOKIES: "true",
      ZERO_MUTATE_FORWARD_COOKIES: "true",
      ZERO_ENABLE_CRUD_MUTATIONS: "false",
      ZERO_ADMIN_PASSWORD: or(env.ZERO_ADMIN_PASSWORD, "development"),
      ZERO_LOG_LEVEL: or(env.ZERO_LOG_LEVEL, "warn"),
    },
  ],
  [
    "platform",
    "bun",
    ["run", "--filter", "@lictory/platform", "dev"],
    { ...env, PORT: "3000" },
  ],
  ["website", "bun", ["run", "--filter", "@lictory/marketing", "dev"], env],
];

const children: ChildProcess[] = [];
for (const [name, command, args, serviceEnv] of services) {
  // Own process group, so stopping also stops what the scripts spawned.
  const child = spawn(command, args, {
    env: serviceEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const prefix = (chunk: Buffer) =>
    chunk
      .toString()
      .split("\n")
      .filter(Boolean)
      .forEach((line) => console.log(`[${name}] ${line}`));
  child.stdout?.on("data", prefix);
  child.stderr?.on("data", prefix);
  child.on("exit", (code) => console.log(`[${name}] exited (${code})`));
  children.push(child);
}

function stop() {
  for (const child of children)
    try {
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      // Already stopped.
    }
  setTimeout(() => process.exit(0), 2000);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
