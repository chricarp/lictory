// The `lictory` command-line interface for self-hosted installations
// (deploy/bin/lictory; the full reference is docs/operations/self-hosting.md).
//
// This is the single place the documentation names its commands: every page
// renders them through <Cli> and <CliReference>. Keep it in step with
// `lictory help`.

/** Downloads and installs the `lictory` command on the server. */
export const bootstrap =
  "curl -fsSL https://raw.githubusercontent.com/chricarp/lictory/main/deploy/get.sh | sudo sh";

export const commands = {
  install: {
    usage: "sudo lictory install",
    summary:
      "Install Lictory on this server, guided step by step: checks the host, asks for the address, services and access policy (or takes them as flags with --yes), starts the first release and creates the first administrator. Re-running it changes only the settings you change.",
  },
  "admin-setup": {
    usage: "sudo lictory admin setup",
    summary:
      "Create the first instance administrator and the organization they own, when install did not (for example with --yes).",
  },
  "admin-grant": {
    usage: "sudo lictory admin grant <email>",
    summary:
      "Make an existing account an instance administrator; revoke removes it. Works from the server when nobody can sign in.",
  },
  "admin-create-user": {
    usage: "sudo lictory admin create-user <email> --name <name>",
    summary:
      "Create an account with a verified email, optionally an administrator (--admin) or a member of an organization (--organization <handle>).",
  },
  "admin-set-password": {
    usage: "sudo lictory admin set-password <email>",
    summary:
      "Set a new password for an account and sign it out everywhere; deactivate and reactivate block or restore sign-in.",
  },
  status: {
    usage: "lictory status [--json]",
    summary:
      "Active version, release channel, the health of each service and the access policy.",
  },
  doctor: {
    usage: "lictory doctor",
    summary:
      "Check the host, the configuration, DNS, certificates, backups and replication, and explain what to fix. Sends no alerts.",
  },
  "database-check": {
    usage: "sudo lictory database check [--json]",
    summary:
      "Check the database against every requirement Lictory has (version, logical replication, roles, slots, TLS, direct connection, collation, event triggers) and name the fix for each gap. deploy.sh runs the same check before migrating an external database.",
  },
  "database-setup": {
    usage: "sudo lictory database setup",
    summary:
      "Create Lictory's roles and databases on an external PostgreSQL with an administrator connection that is used once and never stored. No superuser needed.",
  },
  upgrade: {
    usage: "sudo lictory upgrade [version]",
    summary:
      "Move forward to the newest release of the configured channel, or to an exact newer version: verified digests, backup, migrations, then activation.",
  },
  rollback: {
    usage: "sudo lictory rollback",
    summary:
      "Switch back to the previously activated release. Database migrations stay applied.",
  },
  backup: {
    usage: "sudo lictory backup",
    summary:
      "Take a database backup now, encrypted when a backup key is configured. An external database is backed up by its provider instead.",
  },
  restore: {
    usage: "sudo lictory restore <identity-file|none> [latest|<key>|<file>]",
    summary:
      "Restore the database from a backup (the newest by default), keeping a copy of the current data; --drill restores into a scratch database instead.",
  },
  logs: {
    usage: "lictory logs [service] [-f] [--tail N]",
    summary:
      "Show the logs of every service, or of one (proxy, api, worker, zero-cache, and postgres unless the database is external).",
  },
  "registry-login": {
    usage: "sudo lictory registry-login --username <user>",
    summary:
      "Store a registry token (read from standard input) when release images are private.",
  },
} as const;

export type CliCommand = keyof typeof commands | "bootstrap";
