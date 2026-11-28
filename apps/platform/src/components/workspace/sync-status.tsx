import {
  ChevronRight,
  CloudAlert,
  CloudCheck,
  CloudOff,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
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
import { useCompactSidebar } from "@lictory/platform/components/shell/sidebar-parts";
import { useAnnounceChange } from "@lictory/platform/components/shell/announcer";

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

// A problem is said in words beside the icon, so it is not missed while
// someone keeps editing; routine states stay an icon.
const shortLabels: Partial<Record<Presentation, string>> = {
  offline: "Offline",
  recovering: "Reconnecting…",
  attention: "Not saved",
  access: "Signed out",
};

const titles: Record<Presentation, string> = {
  idle: "Everything is saved",
  busy: "Saving changes…",
  offline: "You’re offline",
  recovering: "Reconnecting…",
  attention: "Sync needs your help",
  access: "Workspace access interrupted",
};

// Whether the browser reports a network at all. Its "online" can be wrong
// (a network without internet), so it only ever says offline sooner.
function useBrowserOffline() {
  const [offline, setOffline] = useState(
    () => typeof navigator !== "undefined" && navigator.onLine === false,
  );
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return offline;
}

// The workspace's sync state, shared by the sidebar indicator and the
// phone's notice.
function useSyncState() {
  const { view, connection, connectionReason, everConnected, reconnect } =
    useWorkspace();
  const recoverable = useRecoveryEntries();
  const rejected = recoverable.filter((e) => e.state === "rejected");
  const pending = view.pending;
  const busyShown = useDebouncedBusy(
    view.status === "hydrating" || pending.length > 0,
  );
  const browserOffline = useBrowserOffline();
  const presentation: Presentation = presentationOf({
    connection,
    everConnected,
    reason: connectionReason,
    busy: busyShown,
    rejected: rejected.length,
    browserOffline,
  });
  const problem = connectionProblem(connection, connectionReason);
  const errors = [
    ...new Set(
      [problem, view.error].filter((error): error is string => !!error),
    ),
  ];
  return { presentation, pending, errors, reconnect, recoverable };
}

function iconOf(presentation: Presentation) {
  return presentation === "offline"
    ? CloudOff
    : presentation === "attention" || presentation === "access"
      ? CloudAlert
      : presentation === "recovering" || presentation === "busy"
        ? RefreshCw
        : CloudCheck;
}

export function SyncStatus() {
  const { presentation, pending, errors, reconnect, recoverable } =
    useSyncState();
  const label = titles[presentation];
  const compact = useCompactSidebar();
  // Reconnecting is usually brief: the spinning icon says it (and it is
  // announced), so the account name beside it keeps its room.
  const word =
    compact || presentation === "recovering"
      ? undefined
      : shortLabels[presentation];
  const recovering = presentation === "recovering" || presentation === "busy";
  const Icon = iconOf(presentation);

  // A problem is said once when it starts, through the workspace's one
  // announcer, not on every save (routine states stay quiet).
  const problemShown = shortLabels[presentation] !== undefined;
  useAnnounceChange("sync", problemShown ? label : "", (_previous, next) =>
    next ? next : null,
  );
  return (
    <Popover
      width={300}
      // Opens over the sidebar it belongs to, not over the page's content.
      side={compact ? "right" : "top"}
      align="end"
      trigger={(props) => (
        <button
          {...props}
          // The visible word starts the name (WCAG 2.5.3).
          aria-label={word && word !== label ? `${word}. ${label}` : label}
          title={label}
          data-sync-status={presentation}
          data-pending={pending.length}
          className={cn(
            "flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md transition-[background-color,color] duration-150 ease-out hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            word ? "px-2 text-xs font-medium" : "w-7",
            presentation === "idle" && "text-muted-foreground/70",
            recovering && "text-muted-foreground",
            presentation === "offline" && "text-warning",
            (presentation === "attention" || presentation === "access") &&
              "text-destructive",
            word &&
              (presentation === "offline"
                ? "bg-warning/10"
                : presentation === "recovering"
                  ? "bg-muted"
                  : "bg-destructive/10"),
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "size-4 shrink-0",
              recovering &&
                "animate-spin [animation-duration:1.4s] motion-reduce:animate-none",
            )}
          />
          {word && <span aria-hidden>{word}</span>}
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

// Phones have no sidebar on screen, so a connection problem is a strip
// above the page instead of a dot hidden in the drawer: people keep typing
// into a page that is not saving otherwise. The sidebar's indicator (mounted
// but hidden here) announces the change; this strip only shows it.
const PHONE_RECOVERING_AFTER_MS = 2000;

export function PhoneSyncNotice() {
  const { presentation, pending, errors, reconnect, recoverable } =
    useSyncState();
  // A brief reconnect stays quiet; one that lasts is shown like the rest.
  const [recoveringLong, setRecoveringLong] = useState(false);
  useEffect(() => {
    if (presentation !== "recovering") return;
    const t = setTimeout(
      () => setRecoveringLong(true),
      PHONE_RECOVERING_AFTER_MS,
    );
    return () => {
      clearTimeout(t);
      setRecoveringLong(false);
    };
  }, [presentation]);
  const shown =
    presentation === "offline" ||
    presentation === "attention" ||
    presentation === "access" ||
    (presentation === "recovering" && recoveringLong);
  if (!shown) return null;
  const Icon = iconOf(presentation);
  const waiting =
    pending.length > 0 && presentation !== "access"
      ? ` · ${pending.length === 1 ? "1 change waiting" : `${pending.length} changes waiting`}`
      : "";
  return (
    <Popover
      width={300}
      align="start"
      trigger={(props) => (
        <button
          {...props}
          data-phone-sync-notice={presentation}
          className={cn(
            "flex min-h-9 w-full shrink-0 items-center gap-2 border-b px-4 py-1.5 text-left text-xs font-medium focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none focus-visible:ring-inset lg:hidden",
            presentation === "offline" && "bg-warning/10 text-warning",
            presentation === "recovering" && "bg-muted text-muted-foreground",
            (presentation === "attention" || presentation === "access") &&
              "bg-destructive/10 text-destructive",
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "size-4 shrink-0",
              presentation === "recovering" &&
                "animate-spin [animation-duration:1.4s] motion-reduce:animate-none",
            )}
          />
          <span className="min-w-0 flex-1">
            {titles[presentation]}
            {waiting}
          </span>
          <ChevronRight aria-hidden className="size-4 shrink-0" />
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
    idle: "Your workspace is up to date.",
    busy: count ? "Sending your changes." : "Checking for updates.",
    offline: "Changes can’t be saved until the connection is back.",
    recovering: "Changes you make now are sent when it’s back.",
    attention: recoverable.length
      ? "Some changes were not applied. Their text is kept on this device."
      : "We couldn’t update this workspace.",
    access: "Your session expired or your access changed.",
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
        <Collapsible className="border-t pt-3 text-xs text-muted-foreground">
          <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronRight
              aria-hidden
              className="size-3 transition-transform duration-150 group-data-open:rotate-90"
            />
            Technical details
          </CollapsibleTrigger>
          <CollapsiblePanel className="mt-2 flex flex-col gap-2 break-words">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </CollapsiblePanel>
        </Collapsible>
      )}
    </div>
  );
}
