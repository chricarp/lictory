import type { ReactNode } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { AppHeader } from "~/components/app/app-header";
import { auth } from "~/lib/auth";

export default async function ProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) redirect("/sign-in");

  return (
    <div className="min-h-dvh bg-background">
      <AppHeader name={session.user.name} email={session.user.email} />
      {children}
    </div>
  );
}
