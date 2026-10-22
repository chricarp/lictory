import { previewKind, socialMetadata } from "@lictory/marketing/lib/social-preview";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppearanceProvider } from "@lictory/platform/components/app/appearance-provider";
import { PostHogIdentity } from "@lictory/platform/components/app/posthog-identity";
import { parseAppearance, parseTheme } from "@lictory/core/lib/appearance";
import { requestSession } from "../session";
import { safeAppPath } from "@lictory/core/lib/paths";

export async function generateMetadata() {
  return socialMetadata(
    previewKind((await headers()).get("x-lictory-path") ?? "/app"),
  );
}

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const requestHeaders = await headers();
  const session = await requestSession();
  if (!session) redirect("/sign-in");
  // Every account, however it signed up, chooses a handle before entering.
  if (!session.user.handle) {
    const next = safeAppPath(requestHeaders.get("x-lictory-path"));
    redirect(`/welcome?next=${encodeURIComponent(next)}`);
  }
  return (
    <AppearanceProvider
      initial={parseAppearance(session.user.appearance)}
      initialTheme={parseTheme(session.user.theme)}
    >
      <PostHogIdentity userId={session.user.id} />
      <div className="min-h-dvh bg-background">{children}</div>
    </AppearanceProvider>
  );
}
