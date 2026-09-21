import { headers } from "next/headers";

import { AccountSettings } from "~/components/app/account-settings";
import { auth, authProviders } from "~/lib/auth";

export default async function AccountPage() {
  const requestHeaders = await headers();
  const [session, accounts, sessions] = await Promise.all([
    auth.api.getSession({ headers: requestHeaders }),
    auth.api.listUserAccounts({ headers: requestHeaders }),
    auth.api.listSessions({ headers: requestHeaders }),
  ]);

  if (!session) return null;

  return (
    <main className="mx-auto max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="mb-9">
        <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
          Settings
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em]">
          Your account
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Manage your identity, sign-in methods, and active sessions.
        </p>
      </div>
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
    </main>
  );
}
