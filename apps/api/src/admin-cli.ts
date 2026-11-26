// Instance administration from the server's command line, for the operator
// who has shell access to the installation (that access is the authority).
// The `lictory admin` host command runs it inside the API container
// (node apps/api/dist/admin.js); from a checkout, `bun run admin`. Help and
// a missing database are answered here, before the commands and their
// database connection load (admin-commands.ts).

const usage = `Usage: bun run admin <command> [options] [--json]
       (on a server: lictory admin <command>, which runs this inside the API container)

  status                       Access policy and counts
  setup                        The first administrator and their organization:
                               --organization <name> [--organization-handle <handle>]
                               --admin-name <full name> --admin-email <email>
                               (--name and --email work too); password from
                               --password-stdin or LICTORY_ADMIN_PASSWORD
  list                         Instance administrators (also list-admins)
  grant <email>                Make an account an instance administrator (also grant-admin)
  revoke <email>               Remove instance administration (also revoke-admin)
  create-user <email>          Create an account: --name <name> [--admin]
                               [--organization <handle> [--role member|admin|owner]]
                               [--password-stdin or LICTORY_USER_PASSWORD]
  set-password <email>         --password-stdin or LICTORY_USER_PASSWORD; also
                               signs them out everywhere
  deactivate <email>           Block sign-in and end every session (reversible)
  reactivate <email>           Allow a deactivated account to sign in again
  ai-status                    AI settings and where they come from
  ai-providers                 The providers Lictory supports
  ai-check                     Live check of the configured providers (synthetic
                               content; exit 1 on failure)
  ai-test < settings.json      Live check of settings before saving
  ai-save < settings.json      Save AI settings (as the admin console does)
  ai-off                       No AI provider; removes stored keys

Passwords come from the first line of stdin (--password-stdin) or the
variables lictory admin reads, never from arguments. With
--json exactly one JSON object goes to stdout. The database is DATABASE_URL
(a checkout's .env counts).

Exit codes: 0 done, 1 refused or failed, 3 already set up, 64 usage.`;

const [command] = process.argv.slice(2);
if (
  command === undefined ||
  command === "help" ||
  command === "--help" ||
  command === "-h" ||
  process.argv.slice(3).some((a) => a === "--help" || a === "-h")
) {
  process.stdout.write(`${usage}\n`);
  process.exit(command === undefined ? 64 : 0);
}
if (!process.env.DATABASE_URL) {
  process.stderr.write(
    "DATABASE_URL is not set. Point it at the database to administer: in a checkout, the one in .env (docs/operations/development.md); on a server, use lictory admin.\n",
  );
  process.exit(1);
}

const { main } = await import("./admin-commands");
await main(usage);

export {};
