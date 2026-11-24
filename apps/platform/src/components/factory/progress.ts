import type { SessionEventRow } from "@lictory/core/factory/entities";

// Where a session's work stands, read from its event log: the last step
// that says what the agent did (a command, a tool, a file change, an
// answer) and the files it changed. Status lines, reasoning and context
// are bookkeeping, not steps.

type Data = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const firstLine = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";

export type SessionStep =
  | { kind: "command"; text: string; exitCode: number | null }
  | { kind: "tool"; text: string }
  | { kind: "message"; text: string }
  | { kind: "files"; text: string }
  | { kind: "approval"; text: string };

export type SessionProgress = {
  step: SessionStep | null;
  files: { path: string; kind: string }[];
  additions: number;
  deletions: number;
  // The window did not reach the session's first event: there may be more
  // changed files than counted.
  partial: boolean;
};

function stepOf(event: SessionEventRow): SessionStep | null {
  const data = (event.data ?? {}) as Data;
  switch (event.type) {
    case "command": {
      const text = firstLine(str(data.command));
      return text
        ? {
            kind: "command",
            text,
            exitCode: typeof data.exitCode === "number" ? data.exitCode : null,
          }
        : null;
    }
    case "tool_call": {
      const text = firstLine(str(data.summary) || str(data.name));
      return text ? { kind: "tool", text } : null;
    }
    case "message": {
      const text = firstLine(str(data.text));
      return text ? { kind: "message", text } : null;
    }
    case "file_change": {
      const changes = Array.isArray(data.changes)
        ? (data.changes as { path?: string }[])
        : [];
      const paths = changes.map((c) => c.path).filter(Boolean) as string[];
      if (!paths.length) return null;
      return {
        kind: "files",
        text:
          paths.length === 1
            ? `Changed ${paths[0]}`
            : `Changed ${paths[0]} and ${paths.length - 1} more`,
      };
    }
    case "approval_request": {
      const text = firstLine(str(data.title));
      return text ? { kind: "approval", text: `Asked: ${text}` } : null;
    }
    default:
      return null;
  }
}

export function sessionProgress(
  events: readonly SessionEventRow[],
): SessionProgress {
  let step: SessionStep | null = null;
  const files = new Map<string, string>();
  let additions = 0;
  let deletions = 0;
  for (const event of events) {
    step = stepOf(event) ?? step;
    if (event.type !== "file_change") continue;
    const data = (event.data ?? {}) as Data;
    if (!Array.isArray(data.changes)) continue;
    for (const change of data.changes as {
      path?: string;
      kind?: string;
      additions?: number;
      deletions?: number;
    }[]) {
      if (!change.path) continue;
      files.set(change.path, change.kind ?? "modify");
      additions += change.additions ?? 0;
      deletions += change.deletions ?? 0;
    }
  }
  return {
    step,
    files: [...files].map(([path, kind]) => ({ path, kind })),
    additions,
    deletions,
    partial: events.length > 0 && events[0]!.sequence !== 1,
  };
}

// "1 file changed", "3+ files changed" when the window may miss some.
export function filesChangedLabel(progress: SessionProgress) {
  const n = progress.files.length;
  const count = `${n}${progress.partial ? "+" : ""}`;
  return `${count} ${n === 1 && !progress.partial ? "file" : "files"} changed`;
}
