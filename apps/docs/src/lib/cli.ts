// The `lictory` command-line interface for self-hosted installations.
//
// This is the single place the documentation names its commands: every page
// renders them through <Cli> and <CliReference>, so the pages can be
// reconciled with the CLI's final interface by editing this file alone.

/** Downloads and installs the `lictory` command on the server. */
export const bootstrap =
  "curl -fsSL https://raw.githubusercontent.com/chricarp/lictory/main/deploy/get.sh | sudo sh";

export const commands = {
  install: {
    usage: "sudo lictory install",
    summary:
      "Install Lictory on this server: asks for the settings it needs (or takes them as flags), then starts the first release.",
  },
  status: {
    usage: "lictory status",
    summary: "Active version, release channel and the health of each service.",
  },
  doctor: {
    usage: "lictory doctor",
    summary:
      "Check the host, the configuration, DNS and certificates, and explain what to fix.",
  },
  upgrade: {
    usage: "lictory upgrade [version]",
    summary:
      "Move to the newest release of the configured channel, or to an exact version: backup, migrations, then activation.",
  },
  rollback: {
    usage: "lictory rollback",
    summary:
      "Switch back to the previously activated release. Database migrations stay applied.",
  },
  backup: {
    usage: "lictory backup",
    summary: "Take an encrypted database backup now.",
  },
  restore: {
    usage: "lictory restore",
    summary: "Restore the database from a backup.",
  },
  logs: {
    usage: "lictory logs [service]",
    summary:
      "Follow the logs of every service, or of one (proxy, api, worker, zero-cache, postgres).",
  },
} as const;

export type CliCommand = keyof typeof commands | "bootstrap";
