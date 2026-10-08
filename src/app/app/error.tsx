"use client";

import Link from "next/link";
import {
  CircleAlert,
  CloudOff,
  HardDrive,
  RotateCcw,
  ShieldOff,
} from "lucide-react";

import { Logo } from "~/components/logo";
import { Button } from "~/components/ui/button";
import { StatusPage } from "~/components/ui/status-page";

function describeWorkspaceError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/access is unavailable|organization access/i.test(message))
    return {
      icon: ShieldOff,
      tone: "danger" as const,
      title: "Access is unavailable",
      body: "Sign in again or open a workspace you still belong to. Queued changes for this organization stay on this device until access is restored.",
    };

  if (/indexeddb|browser storage|local persistence/i.test(message))
    return {
      icon: HardDrive,
      tone: "warning" as const,
      title: "This browser cannot save work",
      body: "Enable IndexedDB, or try a different browser. Without local storage, queued changes cannot be kept on this device.",
    };

  if (/checkpoint is ahead/i.test(message))
    return {
      icon: RotateCcw,
      tone: "warning" as const,
      title: "Workspace cache is out of date",
      body: "Reload to fetch the current server state. Locally queued changes remain in this browser until they can be applied.",
    };

  if (
    /failed to fetch|network|connection interrupted|synchronization failed/i.test(
      message,
    )
  )
    return {
      icon: CloudOff,
      tone: "warning" as const,
      title: "The workspace could not be opened",
      body: "Check your connection and try again. Previously queued changes remain in this browser.",
    };

  return {
    icon: CircleAlert,
    tone: "danger" as const,
    title: "The workspace could not be opened",
    body: "An unexpected error interrupted this page. Try again. Previously queued changes remain in this browser.",
    detail:
      process.env.NODE_ENV === "development" && message ? message : undefined,
  };
}

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const described = describeWorkspaceError(error);
  const detail = [
    described.detail,
    process.env.NODE_ENV === "development" && error.digest
      ? `digest ${error.digest}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <StatusPage
      illustration="recovery"
      brand={<Logo />}
      icon={described.icon}
      tone={described.tone}
      title={described.title}
      detail={detail || undefined}
      actions={
        <>
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
          <Link href="/app" className="contents">
            <Button size="lg" variant="secondary">
              Go to your workspace
            </Button>
          </Link>
        </>
      }
    >
      {described.body}
    </StatusPage>
  );
}
