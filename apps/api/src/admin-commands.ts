// The commands of the instance administration command line (admin-cli.ts,
// which answers help and checks the environment before loading this module
// and the database connection).
import { eq } from "drizzle-orm";
import { checkAiProvider, type AiCheckReport } from "@lictory/core/ai/check";
import {
  describeAiProvider,
  describeTranscription,
} from "@lictory/core/ai/provider-settings";
import {
  aiFieldLabels,
  textProviders,
  transcriptionProviders,
} from "@lictory/core/contracts/ai-provider";
import {
  aiSettingsInput,
  aiSettingsView,
  candidateState,
  refreshAiState,
  saveAiSettings,
} from "@lictory/core/domain/ai-settings";
import { closeDatabase, db } from "@lictory/core/db";
import * as s from "@lictory/core/db/schema";
import {
  createAccount,
  instanceOverview,
  InstanceAdminError,
  listAdministrators,
  setDeactivated,
  setInstanceAdmin,
  setPassword,
  setUpInstance,
  userByEmail,
  type InstanceActor,
  type OrganizationRole,
} from "@lictory/core/domain/instance-admin";

const cli: InstanceActor = { user: null, via: "cli" };

class Usage extends Error {}

type Parsed = {
  positional: string[];
  values: Map<string, string>;
  flags: Set<string>;
};

const VALUE_OPTIONS = new Set([
  "organization",
  "organization-handle",
  "name",
  "email",
  // The host command's names for setup's --name and --email.
  "admin-name",
  "admin-email",
  "role",
]);
const FLAG_OPTIONS = new Set(["json", "password-stdin", "admin"]);

function parse(args: string[]): Parsed {
  const parsed: Parsed = {
    positional: [],
    values: new Map(),
    flags: new Set(),
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      parsed.positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s, 2) as [
      string,
      string | undefined,
    ];
    if (FLAG_OPTIONS.has(name)) {
      if (inline !== undefined) throw new Usage(`--${name} takes no value.`);
      parsed.flags.add(name);
    } else if (VALUE_OPTIONS.has(name)) {
      const value = inline ?? args[++i];
      if (value === undefined) throw new Usage(`--${name} needs a value.`);
      parsed.values.set(name, value);
    } else throw new Usage(`Unknown option --${name}.`);
  }
  return parsed;
}

function required(parsed: Parsed, name: string, what: string) {
  const value = parsed.values.get(name)?.trim();
  if (!value) throw new Usage(`${what} is required (--${name}).`);
  return value;
}

function onlyEmail(parsed: Parsed) {
  if (parsed.positional.length !== 1)
    throw new Usage("Give exactly one account email.");
  return parsed.positional[0]!;
}

// The password: the first line of stdin with --password-stdin, else the
// variable `lictory admin` reads too (LICTORY_ADMIN_PASSWORD for setup,
// LICTORY_USER_PASSWORD otherwise), so both spellings take the same input.
async function readPassword(
  parsed: Parsed,
  variable: "LICTORY_ADMIN_PASSWORD" | "LICTORY_USER_PASSWORD",
) {
  if (!parsed.flags.has("password-stdin"))
    return process.env[variable] || undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const line = Buffer.concat(chunks).toString("utf8").split(/\r?\n/, 1)[0];
  if (!line) throw new Usage("--password-stdin read an empty password.");
  return line;
}

const summary = (u: { id: string; name: string; email: string }) => ({
  id: u.id,
  name: u.name,
  email: u.email,
});

async function organizationByHandle(handle: string) {
  const [organization] = await db
    .select()
    .from(s.organization)
    .where(eq(s.organization.slug, handle.trim().toLowerCase()));
  if (!organization)
    throw new InstanceAdminError(
      "not_found",
      `No organization has the handle ${handle}.`,
      404,
    );
  return organization;
}

const ROLES = new Set(["owner", "admin", "member"]);

function noArguments(parsed: Parsed, command: string) {
  if (parsed.positional.length)
    throw new Usage(`${command} takes no arguments.`);
}

async function readJson() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new Usage("Expected the settings as JSON on stdin.");
  }
}

type Described =
  | ReturnType<typeof describeAiProvider>
  | ReturnType<typeof describeTranscription>;
function describeLine(name: string, d: Described) {
  if (d.state !== "configured")
    return `${name}: ${d.state === "invalid" ? `invalid (${d.problems.join(" ")})` : "off"}`;
  return `${name}: ${d.label}, model ${d.model || "(default)"}, ${d.endpoint}${d.authenticated ? ` (key: ${d.keySetting})` : ""}`;
}

function checkResult(report: AiCheckReport) {
  const lines: string[] = [];
  for (const [name, part] of [
    ["Text", report.text],
    ["Dictation", report.dictation],
  ] as const) {
    if (part.state === "disabled") lines.push(`${name}: off`);
    else if (part.state === "invalid")
      lines.push(`${name}: invalid settings: ${part.problems.join(" ")}`);
    for (const c of part.checks)
      lines.push(
        `${c.ok ? "ok  " : "FAIL"} ${c.id} (${(c.ms / 1000).toFixed(1)} s, for ${c.needs}): ${c.detail}`,
      );
  }
  lines.push(
    report.ok
      ? "Lictory Intelligence can use these providers. The check uses synthetic content; it does not measure quality."
      : report.text.state === "configured"
        ? "Some features will fail with these settings. See docs/operations/ai-providers.md."
        : "No text provider is configured: Lictory Intelligence is off.",
  );
  return {
    json: report as unknown as Record<string, unknown>,
    text: lines.join("\n"),
    code: report.ok ? 0 : 1,
  };
}

type Result = { json: Record<string, unknown>; text: string; code?: number };

async function run(command: string, parsed: Parsed): Promise<Result> {
  switch (command) {
    case "status": {
      const overview = await instanceOverview(db);
      return {
        json: {
          administrators: overview.counts.administrators,
          users: overview.counts.users,
          organizations: overview.counts.organizations,
          signUpMode: overview.policy.signUpMode,
          organizationCreation: overview.policy.organizationCreation,
          allowedEmailDomains: overview.policy.allowedEmailDomains,
          passwordLogin: overview.signIn.password,
          sso: overview.signIn.sso,
          email: overview.email,
        },
        text: [
          `Administrators: ${overview.counts.administrators}`,
          `Accounts: ${overview.counts.users} (${overview.counts.deactivated} deactivated)`,
          `Organizations: ${overview.counts.organizations}`,
          `Sign-up: ${overview.policy.signUpMode}`,
          `Organization creation: ${overview.policy.organizationCreation}`,
          `Allowed email domains: ${overview.policy.allowedEmailDomains.join(", ") || "any"}`,
        ].join("\n"),
      };
    }
    case "setup": {
      const result = await setUpInstance(db, {
        organization: {
          name: required(parsed, "organization", "The organization name"),
          slug: parsed.values.get("organization-handle"),
        },
        administrator: {
          name: required(
            parsed,
            parsed.values.has("admin-name") ? "admin-name" : "name",
            "The administrator's name",
          ),
          email: required(
            parsed,
            parsed.values.has("admin-email") ? "admin-email" : "email",
            "The administrator's email",
          ),
          password: await readPassword(parsed, "LICTORY_ADMIN_PASSWORD"),
        },
      });
      return {
        json: {
          user: result.user,
          organization: {
            id: result.organization.id,
            name: result.organization.name,
            slug: result.organization.slug,
          },
          url: result.url,
        },
        text: `${result.user.email} administers this installation and owns ${result.organization.name}: ${result.url}`,
      };
    }
    case "list":
    case "list-admins": {
      const administrators = await listAdministrators(db);
      return {
        json: { administrators },
        text: administrators.length
          ? administrators
              .map(
                (a) =>
                  `${a.name} <${a.email}>${a.deactivated ? " (deactivated)" : ""}`,
              )
              .join("\n")
          : "No instance administrator yet: lictory admin setup",
      };
    }
    case "grant":
    case "revoke":
    case "grant-admin":
    case "revoke-admin": {
      const grant = command === "grant-admin" || command === "grant";
      const user = await userByEmail(db, onlyEmail(parsed));
      await setInstanceAdmin(db, cli, user.id, grant);
      return {
        json: { user: summary(user), instanceAdmin: grant },
        text: grant
          ? `${user.email} is an instance administrator.`
          : `${user.email} is no longer an instance administrator.`,
      };
    }
    case "create-user": {
      const handle = parsed.values.get("organization");
      const role = parsed.values.get("role") ?? "member";
      if (!ROLES.has(role))
        throw new Usage("--role is member, admin or owner.");
      if (parsed.values.has("role") && !handle)
        throw new Usage("--role needs --organization.");
      const organization = handle ? await organizationByHandle(handle) : null;
      // `create-user <email>`, as the host command writes it, or --email.
      if (!parsed.values.has("email") && parsed.positional.length === 1)
        parsed.values.set("email", parsed.positional[0]!);
      const result = await createAccount(db, cli, {
        name: required(parsed, "name", "The person's name"),
        email: required(parsed, "email", "The person's email"),
        password: await readPassword(parsed, "LICTORY_USER_PASSWORD"),
        instanceAdmin: parsed.flags.has("admin"),
        organization: organization
          ? { id: organization.id, role: role as OrganizationRole }
          : undefined,
      });
      return {
        json: result,
        text: `Created ${result.user.email}${result.organization ? ` in ${result.organization.name}` : ""}.`,
      };
    }
    case "set-password": {
      const user = await userByEmail(db, onlyEmail(parsed));
      const password = await readPassword(parsed, "LICTORY_USER_PASSWORD");
      if (!password)
        throw new Usage(
          "Pass the new password with --password-stdin or LICTORY_USER_PASSWORD.",
        );
      await setPassword(db, cli, user.id, password);
      return {
        json: { user: summary(user) },
        text: `New password set for ${user.email}; their sessions were signed out.`,
      };
    }
    case "deactivate":
    case "reactivate": {
      const deactivated = command === "deactivate";
      const user = await userByEmail(db, onlyEmail(parsed));
      await setDeactivated(db, cli, user.id, deactivated);
      return {
        json: { user: summary(user), deactivated },
        text: deactivated
          ? `${user.email} is deactivated and signed out everywhere.`
          : `${user.email} can sign in again.`,
      };
    }
    case "ai-status": {
      noArguments(parsed, command);
      await refreshAiState(db);
      const view = await aiSettingsView(db);
      const text = describeAiProvider();
      const dictation = describeTranscription();
      return {
        json: { ...view, text, dictation },
        text: [
          `Settings: ${view.source === "environment" ? "the server's environment (read-only here)" : view.stored ? "the admin console / lictory ai setup" : "none yet"}`,
          describeLine("Text", text),
          describeLine("Dictation", dictation),
          ...view.problems.map((p) => `Problem: ${p}`),
          ...view.warnings.map((w) => `Warning: ${w}`),
        ].join("\n"),
      };
    }
    case "ai-providers":
      noArguments(parsed, command);
      return {
        json: {
          text: textProviders,
          transcription: transcriptionProviders,
          fieldLabels: aiFieldLabels,
        },
        text: [
          "Text (LICTORY_AI_PROVIDER):",
          ...Object.entries(textProviders).map(
            ([id, p]) => `  ${id.padEnd(18)} ${p.label} (${p.hosting})`,
          ),
          "Dictation (LICTORY_TRANSCRIPTION_PROVIDER):",
          ...Object.entries(transcriptionProviders).map(
            ([id, p]) =>
              `  ${id.padEnd(18)} ${p.label} (${p.hosting}, ${p.mode === "realtime" ? "live" : "recorded clips"})`,
          ),
        ].join("\n"),
      };
    case "ai-check": {
      noArguments(parsed, command);
      await refreshAiState(db);
      return checkResult(await checkAiProvider());
    }
    // Candidate settings as JSON on stdin (keys never on the command line).
    case "ai-test": {
      noArguments(parsed, command);
      const input = aiSettingsInput.parse(await readJson());
      const { state, problems } = await candidateState(db, input);
      if (problems.length)
        throw new InstanceAdminError("validation", problems.join(" "));
      return checkResult(
        await checkAiProvider({
          text: state.text,
          transcription: state.transcription,
        }),
      );
    }
    case "ai-save": {
      noArguments(parsed, command);
      const input = aiSettingsInput.parse(await readJson());
      await saveAiSettings(db, cli, input);
      return {
        json: {
          ...(await aiSettingsView(db)),
          text: describeAiProvider(),
          dictation: describeTranscription(),
        },
        text: `Saved. ${describeLine("Text", describeAiProvider())}; ${describeLine("Dictation", describeTranscription())}. Running API and worker processes pick it up within ten seconds.`,
      };
    }
    case "ai-off": {
      noArguments(parsed, command);
      await saveAiSettings(db, cli, { text: null, transcription: null });
      return {
        json: { off: true },
        text: "Lictory Intelligence is off: no provider is configured. Stored keys were removed.",
      };
    }
    default:
      throw new Usage(`Unknown command ${command || "(none)"}.`);
  }
}

// A query that failed because the database could not be used at all, in
// words that say what to check instead of the query text.
function databaseProblem(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  if (!(cause instanceof Error) || !("code" in cause)) return null;
  const code = String(cause.code);
  if (code === "42P01")
    return `The database has no Lictory tables yet (${cause.message}). Apply the migrations first (from a checkout: bun run db:migrate).`;
  if (
    /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|CONNECT_TIMEOUT|28P01|28000|3D000)$/.test(
      code,
    )
  )
    return `Could not use the database in DATABASE_URL: ${cause.message} (${code}). Check its host, port, name and credentials, and that PostgreSQL is running.`;
  return null;
}

export async function main(usage: string) {
  const [command = "", ...rest] = process.argv.slice(2);
  let json = rest.includes("--json");
  let code = 0;
  try {
    const parsed = parse(rest);
    json = parsed.flags.has("json");
    const result = await run(command, parsed);
    process.stdout.write(
      json ? `${JSON.stringify(result.json)}\n` : `${result.text}\n`,
    );
    code = result.code ?? 0;
  } catch (error) {
    const known =
      error instanceof InstanceAdminError
        ? { code: error.code, message: error.message }
        : error instanceof Usage
          ? { code: "usage", message: error.message }
          : null;
    const failure = known ?? {
      code: "failed",
      message:
        databaseProblem(error) ??
        (error instanceof Error ? error.message : String(error)),
    };
    code =
      error instanceof Usage ? 64 : failure.code === "already_set_up" ? 3 : 1;
    if (json) process.stdout.write(`${JSON.stringify({ error: failure })}\n`);
    process.stderr.write(`${failure.message}\n`);
    if (error instanceof Usage && !json) process.stderr.write(`\n${usage}\n`);
  }
  await closeDatabase().catch(() => undefined);
  process.exit(code);
}
