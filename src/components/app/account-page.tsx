import { headers } from "next/headers";
import Link from "next/link";
import { and, eq, gt } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";

import { AccountSettings } from "~/components/app/account-settings";
import { db } from "~/db";
import {
  account as accountTable,
  session as sessionTable,
} from "~/db/auth-schema";
import { auth, authProviders } from "~/lib/auth";
import { paths } from "~/lib/paths";
import { initials } from "~/lib/work-items";
import { directory } from "~/sync/server/service";

// Personal settings for the signed-in user, independent of any organization.
export async function AccountPage({
  returnTo,
  connected,
  connectionError,
}: {
  returnTo?: string;
  connected?: string;
  connectionError?: string;
}) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) return null;

  // Better Auth intentionally requires a fresh session for its list-sessions
  // endpoint. Loading settings is not itself a sensitive operation, so read
  // the display-only summary directly while keeping freshness checks on the
  // mutations that revoke sessions or change account security.
  const [accounts, sessions, initialDirectory] = await Promise.all([
    db
      .select({ id: accountTable.id, providerId: accountTable.providerId })
      .from(accountTable)
      .where(eq(accountTable.userId, session.user.id)),
    db
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.userId, session.user.id),
          gt(sessionTable.expiresAt, new Date()),
        ),
      ),
    directory(db, session.user.id),
  ]);
  const defaultOrganization = initialDirectory.organizations[0];
  const safeReturnTo =
    returnTo?.startsWith("/app/") &&
    !returnTo.startsWith("//") &&
    !returnTo.startsWith("/app/account")
      ? returnTo
      : undefined;
  const backHref =
    safeReturnTo ??
    (defaultOrganization ? paths.org(defaultOrganization.slug) : "/app");

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href={backHref}
        className="group mb-6 -ml-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted-foreground transition-[background-color,color,transform] duration-100 ease-out outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96]"
      >
        <ArrowLeft aria-hidden className="size-4" strokeWidth={1.75} />
        Back
      </Link>

      <header className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
        >
          {initials(session.user.name)}
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            Account settings
          </h1>
          <p className="truncate text-[13px] text-muted-foreground">
            {session.user.name} · @{session.user.handle} · applies to you
            everywhere, not to one organization
          </p>
        </div>
      </header>

      <AccountSettings
        user={{
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
          handle: session.user.handle ?? "",
        }}
        providers={authProviders}
        accounts={accounts}
        returnTo={safeReturnTo}
        connected={connected}
        connectionError={connectionError}
        sessionCount={sessions.length}
      />
    </div>
  );
}
