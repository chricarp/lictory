import { headers } from "next/headers";

import { AccountSettings } from "~/components/app/account-settings";
import { auth, authProviders } from "~/lib/auth";

// Personal settings for the signed-in user. Independent of any organization:
// the same content renders inside the workspace shell and standalone for people
// who do not belong to an organization yet.
export async function AccountPage() {
  const requestHeaders = await headers();
  const [session, accounts, sessions] = await Promise.all([
    auth.api.getSession({ headers: requestHeaders }),
    auth.api.listUserAccounts({ headers: requestHeaders }),
    auth.api.listSessions({ headers: requestHeaders }),
  ]);

  if (!session) return null;

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-lg font-semibold tracking-tight">
          Account settings
        </h1>
        <p className="text-[13px] text-muted-foreground">
          Your identity, sign-in methods and active sessions. These apply to you
          everywhere, not to one organization.
        </p>
      </header>
      <AccountSettings
        user={{
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
        }}
        providers={authProviders}
        connectedProviders={accounts.map((account) => account.providerId)}
        sessionCount={sessions.length}
      />
    </div>
  );
}
