import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

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
  return <div className="min-h-dvh bg-background">{children}</div>;
}
