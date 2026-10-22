import { useEffect } from "react";
import {
  CircleAlert,
  CloudOff,
  HardDrive,
  RotateCcw,
  Search,
  ShieldOff,
} from "lucide-react";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { Logo } from "@lictory/ui/logo";
import { Button } from "@lictory/ui/button";
import { StatusPage } from "@lictory/ui/status-page";
import { illustrationAssets } from "@lictory/ui/illustration-assets";
import { trackRenderFailure } from "@lictory/core/lib/analytics/client";
import { Link } from "@lictory/platform/lib/navigation";
import { PageTitle } from "@lictory/platform/routes/title";

function describeWorkspaceError(error: unknown) {
  const message = error instanceof Error ? error.message : "";

  if (/access is unavailable|organization access/i.test(message))
    return {
      icon: ShieldOff,
      tone: "danger" as const,
      title: "Access is unavailable",
      body: "Sign in again or open a workspace you still belong to.",
    };

  if (/indexeddb|browser storage|local persistence/i.test(message))
    return {
      icon: HardDrive,
      tone: "warning" as const,
      title: "This browser cannot save work",
      body: "Enable IndexedDB, or try a different browser. Without local storage, the workspace cannot be kept on this device.",
    };

  if (
    /failed to fetch|dynamically imported module|network|connection interrupted/i.test(
      message,
    )
  )
    return {
      icon: CloudOff,
      tone: "warning" as const,
      title: "The workspace could not be opened",
      body: "Check your connection and try again.",
    };

  if (/session could not be checked/i.test(message))
    return {
      icon: RotateCcw,
      tone: "warning" as const,
      title: "The workspace could not be opened",
      body: message,
    };

  return {
    icon: CircleAlert,
    tone: "danger" as const,
    title: "The workspace could not be opened",
    body: "An unexpected error interrupted this page. Try again.",
    detail: import.meta.env.DEV && message ? message : undefined,
  };
}

export function WorkspaceError({ error, reset }: ErrorComponentProps) {
  const described = describeWorkspaceError(error);
  useEffect(() => {
    trackRenderFailure(undefined);
  }, [error]);
  return (
    <StatusPage
      illustration="recovery"
      brand={<Logo href="/" />}
      icon={described.icon}
      tone={described.tone}
      title={described.title}
      detail={"detail" in described ? described.detail : undefined}
      actions={
        <>
          <Button size="lg" onClick={reset}>
            Try again
          </Button>
          <Link href="/" className="contents">
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

export function WorkspaceNotFound() {
  return (
    <>
      <PageTitle title="Not found" />
      <StatusPage
        illustration="search"
        brand={<Logo href="/" />}
        icon={Search}
        title="This workspace was not found"
        actions={
          <Link href="/" className="contents">
            <Button size="lg">Go to your workspace</Button>
          </Link>
        }
      >
        You may not have access, or the address is misspelled.
      </StatusPage>
    </>
  );
}

// Last resort when the application shell itself failed: no theme, no layout.
export function RootError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    trackRenderFailure(undefined);
  }, [error]);
  return (
    <>
      <style>{`
        .recovery-page { color-scheme: light dark; background: light-dark(#fafafa, #090a0b); color: light-dark(#18181b, #f4f4f5); min-height: 100dvh; display: grid; place-items: center; font-family: system-ui, sans-serif; }
        .recovery-content { max-width: 400px; padding: 48px 24px; text-align: center; }
        .recovery-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px; margin-top: 24px; }
        .recovery-actions button, .recovery-actions a { font: inherit; padding: 12px 18px; border-radius: 10px; border: 1px solid #7777; color: inherit; background: transparent; cursor: pointer; text-decoration: none; }
        .recovery-actions button { background: #3569eb; color: white; border-color: #3569eb; }
      `}</style>
      <main className="recovery-page">
        <div className="recovery-content">
          <img
            src={illustrationAssets.recovery}
            width={160}
            height={160}
            alt=""
            aria-hidden="true"
            decoding="async"
          />
          <h1 style={{ fontSize: 24 }}>Lictory could not open this page</h1>
          <p style={{ fontSize: 14, lineHeight: 1.7 }}>
            An unexpected error interrupted the page. Try again, or return to
            your workspace.
          </p>
          <div className="recovery-actions">
            <button onClick={reset}>Try again</button>
            <a href="/">Open workspace</a>
          </div>
        </div>
      </main>
    </>
  );
}
