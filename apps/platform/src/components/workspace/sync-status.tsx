"use client";
import { applicationRejected } from "@lictory/platform/sync-legacy/persistence";
import { CloudAlert, CloudCheck, CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import { cn } from "@lictory/core/lib/utils";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Routine sync cycles stay quiet; connection problems are shown immediately.
const SHOW_AFTER_MS = 400;
const MIN_VISIBLE_MS = 800;
type Presentation =
  "idle" | "busy" | "offline" | "recovering" | "attention" | "access";

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

const titles: Record<Presentation, string> = {
  idle: "Everything is saved",
  busy: "Saving changes…",
  offline: "You’re offline",
  recovering: "Reconnecting…",
  attention: "Sync needs your help",
  access: "Workspace access interrupted",
};

export function SyncStatus() {
  const { view, engine, refreshWorkspace } = useWorkspace();
  // A definitive application rejection is not a synchronization problem.
  const pending = view.pending.filter((q) => !applicationRejected(q));
  const failures = pending.filter((q) => q.error);
  const busyShown = useDebouncedBusy(
    view.status === "hydrating" ||
      view.status === "syncing" ||
      pending.length > 0,
  );
  const [action, setAction] = useState<"retry" | "refresh" | null>(null);
  const [actionError, setActionError] = useState<string>();
  const presentation: Presentation = view.accessUnavailable
    ? "access"
    : view.status === "offline"
      ? "offline"
      : failures.some((q) => q.blocked) || actionError
        ? "attention"
        : failures.length || view.status === "failed"
          ? "recovering"
          : busyShown || action
            ? "busy"
            : "idle";
  const label = titles[presentation];
  const recovering = presentation === "recovering" || presentation === "busy";
  const Icon =
    presentation === "offline"
      ? CloudOff
      : presentation === "attention" || presentation === "access"
        ? CloudAlert
        : recovering
          ? RefreshCw
          : CloudCheck;
  const recover = async (kind: "retry" | "refresh") => {
    setAction(kind);
    setActionError(undefined);
    try {
      if (kind === "retry") await engine.retryPending();
      else await refreshWorkspace();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Recovery could not be completed.",
      );
    } finally {
      setAction(null);
    }
  };
  const errors = [
    ...new Set(
      [actionError, view.error, ...failures.map((q) => q.error)].filter(
        (error): error is string => !!error,
      ),
    ),
  ];

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
            "grid size-7 shrink-0 place-items-center rounded-md transition-[background-color,color] duration-150 ease-out hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            presentation === "idle" && "text-muted-foreground/70",
            recovering && "text-muted-foreground",
            presentation === "offline" && "text-warning",
            (presentation === "attention" || presentation === "access") &&
              "text-destructive",
          )}
        >
          <Icon
            className={cn(
              "size-4",
              recovering &&
                "animate-spin [animation-duration:1.4s] motion-reduce:animate-none",
            )}
          />
        </button>
      )}
    >
      <SyncPanel
        presentation={presentation}
        count={pending.length}
        errors={errors}
        action={action}
        recover={recover}
      />
    </Popover>
  );
}

function SyncPanel({
  presentation,
  count,
  errors,
  action,
  recover,
}: {
  presentation: Presentation;
  count: number;
  errors: string[];
  action: "retry" | "refresh" | null;
  recover: (kind: "retry" | "refresh") => Promise<void>;
}) {
  const popover = usePopover();
  const waiting =
    count === 1
      ? "1 change is waiting to be saved."
      : `${count} changes are waiting to be saved.`;
  const descriptions: Record<Presentation, string> = {
    idle: "Your workspace is up to date. Changes are shared automatically.",
    busy: count
      ? "Your changes are saved on this device while we send them to the workspace."
      : "We’re checking for the latest workspace updates.",
    offline: "Reconnect to the internet. We’ll resume syncing automatically.",
    recovering:
      "The connection was interrupted. We’re trying again automatically; you can keep working.",
    attention: count
      ? "Automatic retries couldn’t save all your changes. Try again to resume syncing."
      : "We couldn’t update this workspace. Try again to check the connection.",
    access:
      "We can’t access this workspace. Reload the page to check your sign-in and access.",
  };
  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4 text-[13px]">
      <div className="flex flex-col gap-1.5">
        <h2 id={popover?.labelId} className="font-semibold">
          Workspace sync
        </h2>
        <p
          role="status"
          className={cn(
            "font-medium",
            presentation === "attention" && "text-destructive",
          )}
        >
          {titles[presentation]}
        </p>
        <p className="leading-relaxed text-muted-foreground">
          {descriptions[presentation]}
        </p>
        {count > 0 && presentation !== "busy" && (
          <p className="text-muted-foreground">
            {waiting} They’re kept on this device.
          </p>
        )}
      </div>
      {presentation === "access" ? (
        <Button size="sm" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      ) : (
        <div className="flex flex-col gap-3 border-t pt-3">
          {(presentation === "recovering" || presentation === "attention") && (
            <Button
              size="sm"
              disabled={action !== null}
              onClick={() => void recover("retry")}
            >
              {action === "retry" ? "Trying again…" : "Try again"}
            </Button>
          )}
          <div className="flex flex-col gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              disabled={action !== null || presentation === "offline"}
              onClick={() => void recover("refresh")}
            >
              {action === "refresh" ? "Refreshing…" : "Refresh workspace"}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Something looks out of date? Fetch the latest updates. Changes
              waiting to be saved are kept.
            </p>
          </div>
        </div>
      )}
      {errors.length > 0 && (
        <details className="border-t pt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Technical details
          </summary>
          <div className="mt-2 flex flex-col gap-2 break-words">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
