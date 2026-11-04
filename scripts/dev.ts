// Starts the applications for development on one origin:
//   http://localhost:3000  SPA (Vite, proxies /api, /relay and /zero)
//   http://localhost:3002  API        http://localhost:3100  website
//   worker (no port)
// PostgreSQL, migrations, zero-cache and Mailpit run in Docker:
//   docker compose up -d && bun run dev   (reads .env)
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";

// Empty variables count as unset.
const or = (value: string | undefined, fallback: string) =>
  value?.trim() ? value : fallback;
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PLATFORM_URL: or(process.env.PLATFORM_URL, "http://localhost:3000"),
  SITE_URL: or(process.env.SITE_URL, "http://localhost:3100"),
};

// zero-cache runs in Docker (compose.yaml) after the migrations; without it
// the SPA cannot load data, so refuse to start rather than half-work.
const zeroReady = await fetch("http://localhost:4848/keepalive")
  .then((response) => response.ok)
  .catch(() => false);
if (!zeroReady) {
  console.error(
    "zero-cache is not running on http://localhost:4848.\n" +
      "Start the development services first: docker compose up -d\n" +
      "(check them with `docker compose ps` and `docker compose logs migrate zero-cache`).",
  );
  process.exit(1);
}

const services: [string, string, string[], NodeJS.ProcessEnv][] = [
  ["api", "bun", ["run", "--filter", "@lictory/api", "dev"], env],
  ["worker", "bun", ["run", "--filter", "@lictory/worker", "dev"], env],
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
