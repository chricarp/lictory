// How the runner talks to the person at the terminal (or to a log file):
// plain text, never colors, and exit codes a service manager can act on.

// The exit codes `lictory-runner` documents (`lictory-runner --help`).
export const EXIT = {
  ok: 0,
  // Something failed; a service manager may restart the runner.
  failed: 1,
  // A person must act first (the machine is not registered, or its
  // credential was revoked): restarting cannot help, so the generated
  // services do not restart on it.
  needsPerson: 2,
  // The command line is wrong.
  usage: 64,
} as const;

// An error the person can act on, with the exit code it ends with.
export class CliError extends Error {
  constructor(
    message: string,
    readonly code: number = EXIT.failed,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export const say = (line: string) => void process.stdout.write(`${line}\n`);

// Errors go to stderr as plain text: Bun's console.error paints them red
// when FORCE_COLOR is set, even through a pipe or with NO_COLOR.
export const complain = (line: string) =>
  void process.stderr.write(`${line}\n`);

const pad = (n: number) => String(n).padStart(2, "0");

// A log line's time: the clock time at a terminal, where the day is
// obvious; the full ISO time in a log file or pipe, which outlives the day.
export function stamp(date = new Date(), terminal = process.stdout.isTTY) {
  return terminal
    ? `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    : date.toISOString();
}

// "4 s", "3 min", "2 h 5 min", "3 days".
export function duration(ms: number) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48)
    return `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;
  return `${Math.floor(hours / 24)} days`;
}

// "21:34 (3 min ago)" today, "2026-11-24 21:34 (1 day ago)" before.
export function when(iso: string, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.toDateString() === now.toDateString();
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${sameDay ? time : `${day} ${time}`} (${duration(now.getTime() - date.getTime())} ago)`;
}
