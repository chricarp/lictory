"use client";
import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { useWorkspace } from "./provider";

// Compact connection/queue indicator. Failed queued changes are inspectable and
// can be retried or discarded here; nothing is dropped silently.
export function SyncStatus() {
  const { view, engine } = useWorkspace();
  const failed = view.pending.filter((q) => q.error);
  const label =
    view.status === "offline"
      ? "Offline · saved locally"
      : failed.length
        ? `${failed.length} change${failed.length > 1 ? "s" : ""} need attention`
        : view.pending.length
          ? `Saving ${view.pending.length}…`
          : view.status === "hydrating"
            ? "Opening…"
            : view.status === "syncing"
              ? "Syncing…"
              : "Synced";
  const tone =
    view.status === "offline"
      ? "text-amber-600"
      : failed.length || view.status === "failed"
        ? "text-red-600"
        : "text-muted-foreground";
  return (
    <Popover
      width={320}
      side="top"
      trigger={(props) => (
        <button
          {...props}

          role="status"
          aria-label={`Synchronization: ${label}`}
          className={cn(
            "flex items-center gap-1.5 truncate text-[11px] hover:underline",
            tone,
          )}
        >
          {view.status === "offline" ? (
            <WifiOff className="size-3" />
          ) : failed.length || view.status === "failed" ? (
            <AlertTriangle className="size-3" />
          ) : (
            <span
              className={cn(
                "size-1.5 rounded-full",
                view.pending.length || view.status !== "synced"
                  ? "bg-amber-500"
                  : "bg-emerald-500",
              )}
            />
          )}
          <span className="truncate">{label}</span>
        </button>
      )}
    >
      <div className="space-y-3 p-3 text-[13px]">
        <div className="flex items-center justify-between">
          <span className="font-medium">Synchronization</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        {view.error && (
          <p role="alert" className="rounded-md bg-amber-500/10 p-2 text-xs">
            {view.error}
          </p>
        )}
        {failed.map((q) => (
          <div key={q.mutation.id} className="space-y-2 rounded-md border p-2">
            <p className="text-xs">
              <span className="font-medium">{q.mutation.command.type}</span>
              {" · "}
              {q.error}
            </p>
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                Inspect unsaved change
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 whitespace-pre-wrap">
                {JSON.stringify(q.mutation.command, null, 2)}
              </pre>
            </details>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void engine.retry(q.mutation.id)}
              >
                Retry
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void engine.discard(q.mutation.id)}
              >
                Discard
              </Button>
            </div>
          </div>
        ))}
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void engine.sync()}
          >
            <RefreshCw className="size-3" /> Reconnect
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void engine.reset()}>
            Reload server state
          </Button>
        </div>
        {process.env.NODE_ENV === "development" && (
          <p className="text-[11px] text-muted-foreground">
            checkpoint {view.cursor ?? "—"} ·{" "}
            {Object.keys(view.entities).length} entities · pending{" "}
            {view.pending.length}
          </p>
        )}
      </div>
    </Popover>
  );
}
