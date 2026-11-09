// Starts the applications for development on one origin:
//   http://localhost:3000  SPA (Vite, proxies /api, /relay and /zero)
//   http://localhost:3002  API        http://localhost:3100  website
//   http://localhost:3004  collaboration (live drafts; the SPA proxies
//                          /collaboration to it)
//   worker (no port)
// PostgreSQL, migrations, zero-cache and Mailpit run in Docker:
//   docker compose up -d --wait && bun run dev   (both read .env)
//
// Ports follow .env like compose.yaml does: the SPA takes PLATFORM_URL's (or
// BETTER_AUTH_URL's) port, the API LICTORY_DEV_API_PORT, and zero-cache is
// expected on LICTORY_DEV_ZERO_PORT. See docs/operations/development.md.
import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { bunMismatch } from "./bun-version";

// Empty variables count as unset.
const or = (value: string | undefined, fallback: string) =>
  value?.trim() ? value.trim() : fallback;
function port(name: string, fallback: number) {
  const value = Number(or(process.env[name], String(fallback)));
  if (Number.isInteger(value) && value > 0 && value < 65536) return value;
  console.error(`${name} must be a port number (1-65535).`);
  process.exit(1);
}

// Stopping relies on POSIX process groups (process.kill(-pid)).
if (process.platform === "win32") {
  console.error(
    "bun run dev needs macOS or Linux. On Windows, run it inside WSL2 " +
      "(see docs/operations/development.md).",
  );
  process.exit(1);
}

const bun = bunMismatch();
if (bun) console.warn(`warning: ${bun.message}`);

const platformUrl = or(
  process.env.PLATFORM_URL,
  or(process.env.BETTER_AUTH_URL, "http://localhost:3000"),
);
let platformPort: string;
try {
  platformPort = new URL(platformUrl).port || "3000";
} catch {
  console.error(
    `PLATFORM_URL (or BETTER_AUTH_URL) is not a URL: ${platformUrl}`,
  );
  process.exit(1);
}
const apiPort = port("LICTORY_DEV_API_PORT", 3002);
const zeroOrigin = or(
  process.env.ZERO_ORIGIN,
  `http://localhost:${port("LICTORY_DEV_ZERO_PORT", 4848)}`,
);
const env: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PLATFORM_URL: platformUrl,
  SITE_URL: or(process.env.SITE_URL, "http://localhost:3100"),
  API_ORIGIN: or(process.env.API_ORIGIN, `http://localhost:${apiPort}`),
  ZERO_ORIGIN: zeroOrigin,
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const answers = (url: string) =>
  fetch(url, { signal: AbortSignal.timeout(3000) })
    .then((response) => response.ok)
    .catch(() => false);

function run(command: string, args: string[], timeoutMs: number) {
  return new Promise<{ status: number | null; stdout: string }>((done) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: timeoutMs,
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.on("error", () => done({ status: null, stdout }));
    child.on("close", (status) => done({ status, stdout }));
  });
}

// zero-cache as Compose sees it (this checkout's project, from .env), or
// undefined without Docker or outside Compose.
async function composeZeroCache() {
  const { status, stdout } = await run(
    "docker",
    ["compose", "ps", "--all", "--format", "json", "zero-cache"],
    10_000,
  );
  if (status !== 0 || !stdout.trim()) return undefined;
  try {
    const parsed: unknown = stdout.trim().startsWith("[")
      ? JSON.parse(stdout)
      : stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as unknown);
    return (parsed as { State: string; Health: string; Networks: string }[])[0];
  } catch {
    return undefined;
  }
}

// zero-cache runs in Docker (compose.yaml) after the migrations; without it
// the SPA cannot load data, so refuse to start rather than half-work. Right
// after `docker compose up -d` (without --wait) it is still starting: wait
// for it rather than fail.
async function waitForZeroCache() {
  const keepalive = `${zeroOrigin}/keepalive`;
  if (await answers(keepalive)) return true;
  const starting = (container?: { State: string; Health: string }) =>
    container?.State === "running" && container.Health !== "unhealthy";
  if (!starting(await composeZeroCache())) return false;
  console.log(
    `Waiting for zero-cache on ${zeroOrigin} to finish starting ` +
      "(`docker compose up -d --wait` waits for it)…",
  );
  const deadline = Date.now() + 180_000;
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    await sleep(1000);
    if (await answers(keepalive)) return true;
    if (attempt % 5 === 0 && !starting(await composeZeroCache())) return false;
  }
  return false;
}

if (!(await waitForZeroCache())) {
  console.error(
    `zero-cache is not answering on ${zeroOrigin}.\n` +
      "Start the development services first: docker compose up -d --wait\n" +
      "(check them with `docker compose ps` and `docker compose logs migrate zero-cache`).\n" +
      "If it runs on another port, set LICTORY_DEV_ZERO_PORT in .env; compose.yaml publishes that port too.",
  );
  process.exit(1);
}

// Runs inside the zero-cache container: can it reach the API at the address
// it was configured with? Prints "<origin> <outcome>".
const probe = `
const origin = new URL(process.env.ZERO_QUERY_URL).origin;
fetch(origin + "/healthz", { signal: AbortSignal.timeout(5000) }).then(
  (r) => { console.log(origin, r.ok ? "ok" : "HTTP " + r.status); process.exit(r.ok ? 0 : 2); },
  (e) => { console.log(origin, e.cause?.code ?? (e.name === "TimeoutError" ? "timed out" : e.message)); process.exit(2); },
);`;

// zero-cache calls the API on the host for every query and mutation. A host
// firewall that drops traffic from Docker networks breaks that call: sign-up
// works (the browser reaches the API directly), then the workspace never
// opens. Check once the API is up, from where zero-cache stands.
async function checkZeroCacheReachesApi() {
  const deadline = Date.now() + 120_000;
  while (!(await answers(`http://localhost:${apiPort}/healthz`))) {
    if (Date.now() > deadline) return;
    await sleep(1000);
  }
  const result = await run(
    "docker",
    ["compose", "exec", "-T", "zero-cache", "node", "-e", probe],
    20_000,
  );
  // 0: reachable. Anything but 2: no Compose-managed zero-cache to ask.
  if (result.status !== 2) return;
  const [origin = "the API", outcome = "failed"] = result.stdout
    .trim()
    .split("\n")
    .at(-1)!
    .split(/ (.*)/);
  const lines = [
    "",
    "zero-cache cannot reach the API: sign-in works, but the workspace will not",
    'open ("Fetch from API server threw error: fetch failed").',
    `The API answers on http://localhost:${apiPort}, but from inside the zero-cache`,
    `container ${origin}/healthz failed: ${outcome}.`,
  ];
  const calledPort = URL.canParse(origin)
    ? Number(new URL(origin).port || 80)
    : apiPort;
  const host = process.env.HOST?.trim();
  if (calledPort !== apiPort)
    lines.push(
      `zero-cache calls port ${calledPort}, but the API runs on port ${apiPort}.`,
      "Run `docker compose up -d --wait` again after changing LICTORY_DEV_API_PORT.",
    );
  else if (host && /^(127\.|localhost$|::1$)/.test(host))
    lines.push(
      `The API listens on HOST=${host} only. Unset HOST so Docker can reach it.`,
    );
  else {
    const network = (await composeZeroCache())?.Networks.split(",")[0];
    const subnet = network
      ? (
          await run(
            "docker",
            [
              "network",
              "inspect",
              network,
              "--format",
              "{{range .IPAM.Config}}{{.Subnet}} {{end}}",
            ],
            10_000,
          )
        ).stdout
          .split(" ")
          .find((range) => range.includes("."))
      : undefined;
    lines.push(
      "A host firewall most likely drops traffic from Docker networks to the host. Either:",
      `- let ${subnet ? `the Docker network ${subnet}` : "zero-cache's Docker network"} reach port ${apiPort}, for example with ufw:`,
      `    sudo ufw allow from ${subnet ?? "<subnet>"} to any port ${apiPort} proto tcp`,
      "- or run zero-cache on the host's network (Linux): add",
      "    COMPOSE_FILE=compose.yaml:compose.host-network.yaml",
      "  to .env, then run `docker compose up -d --wait` again.",
    );
  }
  lines.push('See "Troubleshooting" in docs/operations/development.md.', "");
  console.error(lines.join("\n"));
}

const services: [string, string, string[], NodeJS.ProcessEnv][] = [
  [
    "api",
    "bun",
    ["run", "--filter", "@lictory/api", "dev"],
    { ...env, PORT: String(apiPort) },
  ],
  ["worker", "bun", ["run", "--filter", "@lictory/worker", "dev"], env],
  [
    "collaboration",
    "bun",
    ["run", "--filter", "@lictory/collaboration", "dev"],
    env,
  ],
  [
    "platform",
    "bun",
    ["run", "--filter", "@lictory/platform", "dev"],
    { ...env, PORT: platformPort },
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
void checkZeroCacheReachesApi();

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
