import { CloudAlert, CloudCheck, CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import { cn } from "@lictory/core/lib/utils";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  connectionProblem,
  presentation as presentationOf,
  type Presentation,
} from "@lictory/platform/data/connection";
import type { RecoveryEntry } from "@lictory/platform/data/recovery";
import {
  RecoveryList,
  useRecoveryEntries,
} from "@lictory/platform/components/workspace/recovery";
import { reauthenticate } from "@lictory/platform/components/workspace/connection-notice";

// Routine sync cycles stay quiet; connection problems are shown immediately.
const SHOW_AFTER_MS = 400;
const MIN_VISIBLE_MS = 800;

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
  const { view, connection, connectionReason, everConnected, reconnect } =
    useWorkspace();
  const recoverable = useRecoveryEntries();
  const rejected = recoverable.filter((e) => e.state === "rejected");
  const pending = view.pending;
  const busyShown = useDebouncedBusy(
    view.status === "hydrating" || pending.length > 0,
  );
  const presentation: Presentation = presentationOf({
    connection,
    everConnected,
    busy: busyShown,
    rejected: rejected.length,
  });
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
  const problem = connectionProblem(connection, connectionReason);
  const errors = [
    ...new Set(
      [problem, view.error].filter((error): error is string => !!error),
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
        reconnect={reconnect}
        recoverable={recoverable}
      />
    </Popover>
  );
}

function SyncPanel({
  presentation,
  count,
  errors,
  reconnect,
  recoverable,
}: {
  presentation: Presentation;
  count: number;
  errors: string[];
  reconnect: () => void;
  recoverable: RecoveryEntry[];
}) {
  const popover = usePopover();
  const waiting =
    count === 1
      ? "1 change is waiting to be saved."
      : `${count} changes are waiting to be saved.`;
  const descriptions: Record<Presentation, string> = {
    idle: "Your workspace is up to date. Changes are shared automatically.",
    busy: count
      ? "We’re sending your changes to the workspace."
      : "We’re checking for the latest workspace updates.",
    offline:
      "Reconnect to the internet. Changes can’t be saved until the connection is back; we’ll reconnect automatically.",
    recovering:
      "The connection was interrupted. We’re trying again automatically; changes you make now are sent when it’s back.",
    attention: recoverable.length
      ? "Some changes were not applied. Their text is kept on this device."
      : "We couldn’t update this workspace. Try again to check the connection.",
    access:
      "Your session expired or your access changed. Sign in again to keep saving changes.",
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
          <p className="text-muted-foreground">{waiting}</p>
        )}
      </div>
      {presentation === "access" ? (
        <Button size="sm" onClick={() => void reauthenticate()}>
          Sign in again
        </Button>
      ) : (
        (presentation === "offline" ||
          presentation === "recovering" ||
          (presentation === "attention" && !recoverable.length)) && (
          <div className="flex flex-col gap-3 border-t pt-3">
            <Button size="sm" onClick={reconnect}>
              Try again
            </Button>
          </div>
        )
      )}
      <RecoveryList entries={recoverable} />
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
