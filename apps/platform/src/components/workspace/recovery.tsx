import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useZero } from "@rocicorp/zero/react";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@lictory/ui/button";
import { queries } from "@lictory/zero/queries";
import type { Entities } from "@lictory/core/contracts/optimistic";
import {
  authoredText,
  effectPresent,
  recoveryScope,
  recoveryText,
  type RecoveryEntry,
} from "@lictory/platform/data/recovery";
import type { SyncRow } from "@lictory/platform/data/rows";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Entries this tab is not waiting for: rejected ones, and those left over from
// an earlier session whose effect is not visible in synchronized data.
export function useRecoveryEntries() {
  const { recovery, view } = useWorkspace();
  const entries = useSyncExternalStore(
    recovery.subscribe,
    recovery.snapshot,
    recovery.snapshot,
  );
  const waiting = useMemo(
    () => new Set(view.pending.map((p) => p.mutation.id)),
    [view.pending],
  );
  return useMemo(
    () => entries.filter((e) => !waiting.has(e.id)),
    [entries, waiting],
  );
}

const SETTLE_MS = 3000;

// After a reload, entries from the previous session are checked against
// synchronized data once the workspace is connected and complete (Zero sends
// mutations it still holds first). Confirmed effects are dropped silently.
export function RecoveryWatcher() {
  const zero = useZero();
  const { recovery, view, organization, connection } = useWorkspace();
  const entries = useRecoveryEntries();
  const ready = connection === "connected" && view.status === "synced";
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ready || settled) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [ready, settled]);
  const stale = useMemo(
    () => entries.filter((e) => e.state === "pending"),
    [entries],
  );
  useEffect(() => {
    if (!settled || !stale.length) return;
    let cancelled = false;
    void (async () => {
      for (const entry of stale) {
        let entities: Entities = view.entities;
        const scope = recoveryScope(entry.command);
        if (scope) {
          try {
            const rows = (await zero.run(
              queries.workItem({
                organizationId: organization.id,
                workItemId: scope,
              }),
              { type: "complete" },
            )) as readonly SyncRow[];
            entities = { ...entities };
            for (const row of rows) entities[row.key] = row.data as never;
          } catch {
            continue;
          }
        }
        if (cancelled) return;
        if (effectPresent(entry.command, entities)) recovery.remove(entry.id);
        else
          recovery.reject(
            entry.id,
            "This change was not confirmed before the page closed.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, stale, view.entities, zero, organization.id, recovery]);
  return null;
}

const describe: Partial<Record<RecoveryEntry["command"]["type"], string>> = {
  createProject: "New project",
  createWorkItem: "New work item",
  updateSpecification: "Specification edit",
  createThread: "Comment",
  replyToThread: "Reply",
  commitBranch: "Branch commit",
  syncBranch: "Branch update",
  createPullRequest: "Pull request",
  createSuggestion: "Suggestion",
  updateSuggestion: "Suggestion edit",
};

export function RecoveryList({ entries }: { entries: RecoveryEntry[] }) {
  const { recovery } = useWorkspace();
  const [copied, setCopied] = useState<string>();
  if (!entries.length) return null;
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="font-medium">Not saved</p>
      <p className="text-xs leading-relaxed text-muted-foreground">
        These changes were not applied. Their text is kept on this device: copy
        it to try again, or discard it.
      </p>
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => {
          const preview = authoredText(entry.command)
            .map((f) => f.text)
            .join(" · ");
          return (
            <li
              key={entry.id}
              className="flex flex-col gap-1.5 rounded-md border bg-muted/40 p-2"
            >
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {describe[entry.command.type] ?? "Change"}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Copy text"
                  title={copied === entry.id ? "Copied" : "Copy text"}
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(recoveryText(entry.command))
                      .then(() => setCopied(entry.id))
                  }
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Discard"
                  title="Discard"
                  onClick={() => recovery.remove(entry.id)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
              <p className="line-clamp-2 text-xs break-words text-muted-foreground">
                {preview}
              </p>
              {entry.error && (
                <p className="text-xs break-words text-destructive">
                  {entry.error}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
