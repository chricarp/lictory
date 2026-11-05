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
  version: {
    usage: "lictory version [--json]",
    summary:
      "The release of the host tools and of every environment on the server, with its channel.",
  },
  status: {
    usage: "lictory status [--json]",
    summary:
      "Active version, release channel, the health of each service and the access policy.",
  },
  doctor: {
    usage: "lictory doctor [--json]",
    summary:
      "Check the host, the configuration, DNS, certificates, backups and replication, and explain what to fix. Sends no alerts.",
  },
  config: {
    usage: "sudo lictory config set <KEY=value>",
    summary:
      "Show (secrets masked), change or edit the environment's settings and restart the services with them; a change the services reject is undone. config apply applies a hand edit of .env.",
  },
  upgrade: {
    usage: "sudo lictory upgrade [version]",
    summary:
      "Move forward to the newest release of the configured channel, or to an exact newer version: verified digests, backup, migrations, then activation. --check only reports whether a newer release exists (exit 10).",
  },
  rollback: {
    usage: "sudo lictory rollback",
    summary:
      "Switch back to the previously activated release. Database migrations stay applied.",
  },
  backup: {
    usage: "sudo lictory backup",
    summary:
      "Take a database backup now, encrypted when a backup key is configured.",
  },
  "backup-list": {
    usage: "sudo lictory backup list [--json]",
    summary:
      "The stored backups in the configured target, newest first: daily, weekly, monthly, manual and pre-deploy, with the key to restore each.",
  },
  restore: {
    usage: "sudo lictory restore <identity-file|none> [latest|<key>|<file>]",
    summary:
      "Restore the database from a backup (the newest by default), keeping a copy of the current data; --drill restores into a scratch database instead.",
  },
  logs: {
    usage: "lictory logs [service] [-f] [--tail N] [--since 2h]",
    summary:
      "Show the logs of every service, or of one (proxy, api, worker, zero-cache, postgres).",
  },
  "support-bundle": {
    usage: "sudo lictory support-bundle [--since 24h]",
    summary:
      "Write one archive for a bug report: versions, status, doctor, settings and recent logs, with secrets, email addresses and tokens removed.",
  },
  uninstall: {
    usage: "sudo lictory uninstall [--purge]",
    summary:
      "Stop an environment and remove its containers and timers, keeping its data and settings; --purge deletes it for good after a final off-server backup and a typed confirmation.",
  },
  "registry-login": {
    usage: "sudo lictory registry-login --username <user>",
    summary:
      "Store a registry token (read from standard input) when release images are private.",
  },
} as const;

export type CliCommand = keyof typeof commands | "bootstrap";
