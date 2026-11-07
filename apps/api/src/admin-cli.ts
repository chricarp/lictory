// Instance administration from the server's command line, for the operator
// who has shell access to the installation (that access is the authority).
// The `lictory admin` host command runs it inside the API container:
//
//   node apps/api/dist/admin.js <command> [options] [--json]
//
//   status                                   policy and counts
//   setup --organization <name> [--organization-handle <handle>]
//         --name <full name> --email <email> [--password-stdin]
//                                            first administrator and organization
//   list-admins
//   grant-admin <email> | revoke-admin <email>
//   create-user --email <email> --name <name> [--admin]
//         [--organization <handle> [--role member|admin|owner]] [--password-stdin]
//   set-password <email> --password-stdin   also signs them out everywhere
//   deactivate <email> | reactivate <email>
//   ai-check                                 live check of the AI provider
//                                            (synthetic prompts; exit 1 on failure)
//
// Passwords are read from the first line of stdin, never from arguments.
// With --json exactly one JSON object goes to stdout. Exit codes: 0 done,
// 1 refused or failed, 3 already set up, 64 usage.
import { eq } from "drizzle-orm";
import { checkAiProvider } from "@lictory/core/ai/check";
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

async function readPassword(parsed: Parsed) {
  if (!parsed.flags.has("password-stdin")) return undefined;
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
          name: required(parsed, "name", "The administrator's name"),
          email: required(parsed, "email", "The administrator's email"),
          password: await readPassword(parsed),
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
    case "grant-admin":
    case "revoke-admin": {
      const grant = command === "grant-admin";
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
      const result = await createAccount(db, cli, {
        name: required(parsed, "name", "The person's name"),
        email: required(parsed, "email", "The person's email"),
        password: await readPassword(parsed),
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
      const password = await readPassword(parsed);
      if (!password)
        throw new Usage("Pass the new password with --password-stdin.");
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
    case "ai-check": {
      if (parsed.positional.length)
        throw new Usage("ai-check takes no arguments.");
      const report = await checkAiProvider();
      const { provider } = report;
      const lines =
        provider.state === "configured"
          ? [
              `Provider: ${provider.label} (${provider.protocol})`,
              `Endpoint: ${provider.endpoint}${provider.authenticated ? ` (key from ${provider.keySetting})` : " (no key)"}`,
              `Model: ${provider.model}`,
              ...report.checks.map(
                (c) =>
                  `${c.ok ? "ok  " : "FAIL"} ${c.id} (${(c.ms / 1000).toFixed(1)} s, ${c.needs}): ${c.detail}`,
              ),
              report.ok
                ? "Lictory Intelligence can use this provider. This checks compatibility with synthetic content, not the quality of real reviews."
                : "Some features will fail with this provider and model. See docs/operations/ai-providers.md.",
            ]
          : provider.state === "invalid"
            ? ["The AI provider settings are invalid:", ...provider.problems]
            : [
                "No AI provider is configured (LICTORY_AI_PROVIDER, or OPENAI_API_KEY). Lictory Intelligence is off on this server.",
              ];
      return {
        json: report as unknown as Record<string, unknown>,
        text: lines.join("\n"),
        code: report.ok ? 0 : 1,
      };
    }
    default:
      throw new Usage(`Unknown command ${command || "(none)"}.`);
  }
}

async function main() {
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
      message: error instanceof Error ? error.message : String(error),
    };
    code =
      error instanceof Usage ? 64 : failure.code === "already_set_up" ? 3 : 1;
    if (json) process.stdout.write(`${JSON.stringify({ error: failure })}\n`);
    process.stderr.write(`${failure.message}\n`);
  }
  await closeDatabase().catch(() => undefined);
  process.exit(code);
}

await main();
