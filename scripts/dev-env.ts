// Prepares .env so this checkout's development services start beside any
// other checkout on the machine:
//
//   bun run dev:env
//
// It copies .env.example when .env is missing. When the Compose project
// `lictory` belongs to another checkout, it gives this one its own project
// name. When a development port is taken, it moves every port by the same
// offset (the defaults plus 10000, 20000, …) and rewrites the settings that
// name them (DATABASE_URL, SMTP_PORT, S3_ENDPOINT, BETTER_AUTH_URL…). On Linux
// it also checks that a Docker container can reach the host, and turns on
// compose.host-network.yaml when a firewall blocks it. Running it again keeps
// what still works. See docs/operations/development.md.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Every port a checkout uses in development, with its default. */
const devPorts = {
  LICTORY_DEV_POSTGRES_PORT: 5432,
  LICTORY_DEV_ZERO_PORT: 4848,
  LICTORY_DEV_SMTP_PORT: 1025,
  LICTORY_DEV_MAILPIT_PORT: 8025,
  LICTORY_DEV_MINIO_PORT: 9000,
  LICTORY_DEV_MINIO_CONSOLE_PORT: 9001,
  LICTORY_DEV_API_PORT: 3002,
  // The applications on the host (bun run dev).
  LICTORY_DEV_APP_PORT: 3000,
  // The worker's loopback health endpoint: two checkouts collide on it too.
  WORKER_HEALTH_PORT: 3003,
  COLLABORATION_PORT: 3004,
  LICTORY_DEV_WEBSITE_PORT: 3100,
} as const;
type PortName = keyof typeof devPorts;

// 9001 + 50000 is the highest port that stays below 65536.
const offsets = [0, 10000, 20000, 30000, 40000, 50000];

export const portsAt = (offset: number) =>
  Object.fromEntries(
    Object.entries(devPorts).map(([name, port]) => [name, port + offset]),
  ) as Record<PortName, number>;

/** The settings a port offset changes, as .env assignments. */
export function settingsAt(offset: number): Record<string, string> {
  const p = portsAt(offset);
  const app = `http://localhost:${p.LICTORY_DEV_APP_PORT}`;
  const settings: Record<string, string> = {
    DATABASE_URL: `postgresql://lictory:lictory@localhost:${p.LICTORY_DEV_POSTGRES_PORT}/lictory`,
    SMTP_PORT: String(p.LICTORY_DEV_SMTP_PORT),
    S3_ENDPOINT: `http://127.0.0.1:${p.LICTORY_DEV_MINIO_PORT}`,
    BETTER_AUTH_URL: app,
    PLATFORM_URL: app,
    SITE_URL: `http://localhost:${p.LICTORY_DEV_WEBSITE_PORT}`,
    COLLABORATION_ORIGIN: `http://localhost:${p.COLLABORATION_PORT}`,
  };
  for (const [name, port] of Object.entries(p))
    if (name !== "LICTORY_DEV_APP_PORT" && name !== "LICTORY_DEV_WEBSITE_PORT")
      settings[name] = String(port);
  return settings;
}

/** The offset .env uses now (0 when it names the default ports). */
export function currentOffset(env: Record<string, string>) {
  const postgres = Number(env.LICTORY_DEV_POSTGRES_PORT);
  const offset = Number.isInteger(postgres) ? postgres - 5432 : 0;
  return offsets.includes(offset) ? offset : 0;
}

/** Reads .env assignments (KEY=value, comments and blank lines skipped). */
export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
    if (match)
      env[match[1]!] = match[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

/**
 * Sets each variable in .env text: replaces its assignment (or a commented
 * `# NAME=` line) in place, or appends it under one heading.
 */
export function withSettings(text: string, settings: Record<string, string>) {
  const lines = text.split("\n");
  const appended: string[] = [];
  for (const [name, value] of Object.entries(settings)) {
    const assignment = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);
    const commented = new RegExp(`^#\\s*${name}=`);
    let index = lines.findIndex((line) => assignment.test(line));
    if (index < 0) index = lines.findIndex((line) => commented.test(line));
    if (index >= 0) lines[index] = `${name}=${value}`;
    else appended.push(`${name}=${value}`);
  }
  if (!appended.length) return lines.join("\n");
  const body = lines.join("\n").replace(/\n*$/, "");
  return `${body}\n\n# This checkout's development ports (bun run dev:env)\n${appended.join("\n")}\n`;
}

/** A Compose project name for this checkout: lictory-<directory>. */
export function projectName(directory: string) {
  const slug = basename(directory)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^lictory-/, "")
    .slice(0, 30);
  return slug && slug !== "lictory" ? `lictory-${slug}` : "lictory-2";
}

function docker(args: string[]) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** The checkout directories that own containers of a Compose project. */
function projectDirectories(project: string) {
  const out = docker([
    "ps",
    "--all",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    '{{.Label "com.docker.compose.project.working_dir"}}',
  ]);
  return new Set((out ?? "").split("\n").filter(Boolean));
}

function portFree(port: number) {
  return new Promise<boolean>((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });
}

// Can a container on a Docker bridge reach a port on this host? The answer
// for zero-cache, which calls the API there. Null when it cannot be told.
async function dockerReachesHost(image: string) {
  const server = createServer((socket) => socket.end());
  const port = await new Promise<number>((done) =>
    server.listen(0, "0.0.0.0", () =>
      done((server.address() as { port: number }).port),
    ),
  );
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--add-host=host.docker.internal:host-gateway",
      image,
      "sh",
      "-c",
      `nc -z -w 3 host.docker.internal ${port}`,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  server.close();
  if (result.status === null || result.error) return null;
  return result.status === 0;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) {
    copyFileSync(join(root, ".env.example"), envPath);
    console.log("Created .env from .env.example.");
  }
  let text = readFileSync(envPath, "utf8");
  const env = parseEnv(text);
  const changes: Record<string, string> = {};
  const notes: string[] = [];
  const hasDocker = docker(["version", "--format", "{{.Server.Version}}"]);
  if (!hasDocker)
    notes.push(
      "Docker is not running: the Compose project and the firewall were not checked.",
    );

  // 1. The Compose project: another checkout's containers must not be ours.
  // An empty COMPOSE_PROJECT_NAME counts as unset, as in Compose.
  const configured = env.COMPOSE_PROJECT_NAME?.trim()
    ? env.COMPOSE_PROJECT_NAME
    : "lictory";
  let project = configured;
  const ours = hasDocker ? projectDirectories(project) : new Set<string>();
  const taken = [...ours].some((directory) => resolve(directory) !== root);
  if (taken) {
    project = projectName(root);
    for (
      let n = 2;
      [...projectDirectories(project)].some((d) => resolve(d) !== root);
      n++
    )
      project = `${projectName(root)}-${n}`;
    changes.COMPOSE_PROJECT_NAME = project;
    notes.push(
      `Compose project ${configured} belongs to another checkout; this one is ${project}.`,
    );
  }
  const running =
    hasDocker &&
    !taken &&
    !!docker([
      "ps",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ]);

  // 2. Ports: keep the current set while it is free (or this checkout's own
  // services hold it), else the first free offset.
  const current = currentOffset(env);
  let chosen: number | undefined;
  if (running) chosen = current;
  else
    for (const offset of [current, ...offsets.filter((o) => o !== current)]) {
      const free = await Promise.all(
        Object.values(portsAt(offset)).map(portFree),
      );
      if (free.every(Boolean)) {
        chosen = offset;
        break;
      }
    }
  if (chosen === undefined) {
    console.error(
      "No free set of development ports was found (the defaults plus 0 to 50000). Free some, or set the LICTORY_DEV_*_PORT variables by hand.",
    );
    process.exit(1);
  }
  if (chosen !== current || chosen !== 0) {
    for (const [name, value] of Object.entries(settingsAt(chosen)))
      if (env[name] !== value) changes[name] = value;
    if (chosen !== current)
      notes.push(
        `Ports move to the defaults plus ${chosen} (PostgreSQL ${portsAt(chosen).LICTORY_DEV_POSTGRES_PORT}, app ${settingsAt(chosen).BETTER_AUTH_URL}).`,
      );
  }

  // 3. Linux firewalls that drop Docker → host traffic break zero-cache.
  if (
    hasDocker &&
    process.platform === "linux" &&
    !(env.COMPOSE_FILE ?? "").includes("compose.host-network.yaml")
  ) {
    const compose = readFileSync(join(root, "compose.yaml"), "utf8");
    const image = /image:\s*(postgres:\S+)/.exec(compose)?.[1];
    const reaches = image ? await dockerReachesHost(image) : null;
    if (reaches === false) {
      changes.COMPOSE_FILE = "compose.yaml:compose.host-network.yaml";
      notes.push(
        "Docker containers cannot reach this host (a firewall drops it): zero-cache runs on the host network (compose.host-network.yaml).",
      );
    } else if (reaches === null)
      notes.push(
        "Could not check whether Docker reaches this host; `bun run dev` checks it again.",
      );
  }

  if (Object.keys(changes).length) {
    text = withSettings(text, changes);
    writeFileSync(envPath, text);
    console.log("Updated .env:");
    for (const [name, value] of Object.entries(changes))
      console.log(`  ${name}=${value}`);
  } else console.log(".env already fits this machine; nothing changed.");
  for (const note of notes) console.log(`- ${note}`);
  if (running)
    console.log(
      "- This checkout's services are running; ports were left as they are.",
    );
  console.log("Next: docker compose up -d --wait && bun run dev");
}

if (import.meta.main) await main();
