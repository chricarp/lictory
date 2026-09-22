"use client";
import { CloudAlert, CloudCheck, CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { Popover } from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { useWorkspace } from "./provider";

// Quiet-by-default synchronization indicator.
//
// The engine flips through "syncing" every few seconds (SSE wake-ups, focus,
// every local write). Rendering each flip would make the footer flicker, so
// activity is only surfaced when a cycle is actually slow, and once shown it
// stays long enough to be read. Problems (offline, failed changes) are shown
// immediately and stay until resolved; a healthy state stays out of the way.
const SHOW_AFTER_MS = 400;
const MIN_VISIBLE_MS = 800;

type Presentation = "idle" | "busy" | "offline" | "attention";

function useDebouncedBusy(busy: boolean) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (busy && !shown) {
      const t = setTimeout(() => setShown(true), SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    if (!busy && shown) {
      const t = setTimeout(() => setShown(false), MIN_VISIBLE_MS);
      return () => clearTimeout(t);
    }
  }, [busy, shown]);
  return shown;
}

export function SyncStatus() {
  const { view, engine } = useWorkspace();
  const failed = view.pending.filter((q) => q.error);
  const busy =
    view.status === "hydrating" ||
    view.status === "syncing" ||
    view.pending.length > failed.length;
  const busyShown = useDebouncedBusy(busy);

  const presentation: Presentation =
    view.status === "offline"
      ? "offline"
      : failed.length || view.status === "failed"
        ? "attention"
        : busyShown
          ? "busy"
          : "idle";

  const label =
    presentation === "offline"
      ? "Offline · changes saved on this device"
      : presentation === "attention"
        ? failed.length
          ? `${failed.length} change${failed.length > 1 ? "s" : ""} could not be saved`
          : "Sync failed"
        : presentation === "busy"
          ? view.pending.length
            ? `Saving ${view.pending.length} change${view.pending.length > 1 ? "s" : ""}…`
            : view.status === "hydrating"
              ? "Opening…"
              : "Syncing…"
          : "Everything is saved";

  return (
    <Popover
      width={320}
      side="top"
      trigger={(props) => (
        <button
          {...props}
          aria-label={label}
          title={label}
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md transition-[opacity,background-color,color] duration-150 ease-out hover:bg-sidebar-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            presentation === "idle" && "text-muted-foreground/70",
            presentation === "busy" && "text-muted-foreground",
            presentation === "offline" && "text-amber-600",
            presentation === "attention" && "text-red-600",
          )}
        >
          {presentation === "offline" ? (
            <CloudOff className="size-3.5" />
          ) : presentation === "attention" ? (
            <CloudAlert className="size-3.5" />
          ) : presentation === "busy" ? (
            <RefreshCw className="size-3.5 animate-spin [animation-duration:1.4s]" />
          ) : (
            <CloudCheck className="size-3.5" />
          )}
        </button>
      )}
    >
      <div className="space-y-3 overflow-scroll p-3 text-[13px]">
        <div className="space-y-0.5">
          <p className="font-medium">Synchronization</p>
          <p role="status" className="text-xs text-muted-foreground">
            {label}
          </p>
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
            <RefreshCw className="size-3" /> Sync now
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
