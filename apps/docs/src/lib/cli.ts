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
      "Install Lictory on this server: checks the host, asks for the settings it needs (or takes them as flags with --yes), then starts the first release. Re-running it changes only the settings you change.",
  },
  status: {
    usage: "lictory status [--json]",
    summary: "Active version, release channel and the health of each service.",
  },
  doctor: {
    usage: "lictory doctor",
    summary:
      "Check the host, the configuration, DNS, certificates, backups and replication, and explain what to fix. Sends no alerts.",
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
      "Take a database backup now, encrypted when a backup key is configured.",
  },
  restore: {
    usage: "sudo lictory restore <identity-file|none> [latest|<key>|<file>]",
    summary:
      "Restore the database from a backup (the newest by default), keeping a copy of the current data; --drill restores into a scratch database instead.",
  },
  logs: {
    usage: "lictory logs [service] [-f] [--tail N]",
    summary:
      "Show the logs of every service, or of one (proxy, api, worker, zero-cache, postgres).",
  },
  "registry-login": {
    usage: "sudo lictory registry-login --username <user>",
    summary:
      "Store a registry token (read from standard input) when release images are private.",
  },
} as const;

export type CliCommand = keyof typeof commands | "bootstrap";
