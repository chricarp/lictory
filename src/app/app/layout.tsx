import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppearanceProvider } from "~/components/app/appearance-provider";
import { parseAppearance } from "~/lib/appearance";
import { auth } from "~/lib/auth";
import { safeAppPath } from "~/lib/paths";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect("/sign-in");
  // Every account, however it signed up, chooses a handle before entering.
  if (!session.user.handle) {
    const next = safeAppPath(requestHeaders.get("x-lictory-path"));
    redirect(`/welcome?next=${encodeURIComponent(next)}`);
  }
  return (
    <AppearanceProvider initial={parseAppearance(session.user.appearance)}>
      <div className="min-h-dvh bg-background">{children}</div>
    </AppearanceProvider>
  );
}
