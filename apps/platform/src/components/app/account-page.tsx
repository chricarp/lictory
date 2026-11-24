import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { CircleAlert } from "lucide-react";
import { z } from "zod";

import { AccountSettings } from "@lictory/platform/components/app/account-settings";
import { paths, safeCallbackPath } from "@lictory/core/lib/paths";
import { queries } from "@lictory/zero/queries";
import type { OrganizationProfile } from "@lictory/core/contracts/projection";
import { PageHeader } from "@lictory/platform/components/shell/page-header";
import { PersonAvatar } from "@lictory/platform/components/identity/actor";
import { Button } from "@lictory/ui/button";
import { SettingsSectionSkeleton } from "@lictory/ui/skeleton";
import { MissingState } from "@lictory/ui/status-page";
import { onAccountChanged } from "@lictory/platform/lib/account";

const accountSchema = z.object({
  user: z.object({
    name: z.string(),
    image: z.string().nullable(),
    email: z.string(),
    emailVerified: z.boolean(),
    handle: z.string().nullable().optional(),
    twoFactorEnabled: z.boolean().default(false),
  }),
  providers: z.object({
    google: z.boolean(),
    microsoft: z.boolean(),
    oidc: z.boolean().default(false),
  }),
  signIn: z
    .object({ password: z.boolean(), ssoName: z.string().nullable() })
    .default({ password: true, ssoName: null }),
  accounts: z.array(z.object({ id: z.string(), providerId: z.string() })),
  sessionCount: z.number().int(),
});
type Account = z.infer<typeof accountSchema>;

async function loadAccount(): Promise<Account> {
  const response = await fetch("/api/account", {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      (body as { error?: { message?: string } } | null)?.error?.message ??
        "Your account settings could not be loaded.",
    );
  return accountSchema.parse(body);
}

// Personal settings for the signed-in user, independent of any organization.
export function AccountPage({
  returnTo,
  connected,
  connectionError,
}: {
  returnTo?: string;
  connected?: string;
  connectionError?: string;
}) {
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState<string>();
  const reload = useCallback(() => {
    loadAccount()
      .then((value) => {
        setAccount(value);
        setError(undefined);
      })
      .catch((e: unknown) =>
        setError(
          e instanceof Error
            ? e.message
            : "Your account settings could not be loaded.",
        ),
      );
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => onAccountChanged(reload), [reload]);
  const [memberships] = useQuery(queries.memberships());
  const defaultOrganization = memberships
    .map((m) => m.organization[0]?.data as OrganizationProfile | undefined)
    .find((o) => !!o);
  const safe = returnTo ? safeCallbackPath(returnTo) : undefined;
  const safeReturnTo =
    safe && safe !== "/" && !safe.startsWith("/account") ? safe : undefined;
  const backHref =
    safeReturnTo ??
    (defaultOrganization ? paths.org(defaultOrganization.slug) : "/");

  if (error && !account)
    return (
      <MissingState
        illustration="recovery"
        icon={CircleAlert}
        tone="danger"
        title="Account settings are unavailable"
        action={<Button onClick={reload}>Try again</Button>}
      >
        {error}
      </MissingState>
    );
  if (!account)
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <SettingsSectionSkeleton />
      </div>
    );
  return (
    <>
      {/* Account settings live outside any organization, so the header
          stays on top of the page as it scrolls. */}
      <PageHeader
        title="Account settings"
        back={{ label: "Back", href: backHref }}
        meta={
          <>
            <PersonAvatar
              person={{
                id: account.user.handle ?? account.user.email,
                name: account.user.name,
                image: account.user.image,
              }}
              size={20}
            />
            <span className="truncate">
              {account.user.name} · @{account.user.handle} · applies to you
              everywhere, not to one organization
            </span>
          </>
        }
        className="sticky top-0 z-20 bg-background"
      />
      <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <AccountSettings
          user={{
            name: account.user.name,
            image: account.user.image,
            email: account.user.email,
            emailVerified: account.user.emailVerified,
            handle: account.user.handle ?? "",
            twoFactorEnabled: account.user.twoFactorEnabled,
          }}
          providers={account.providers}
          signIn={account.signIn}
          accounts={account.accounts}
          returnTo={safeReturnTo}
          connected={connected}
          connectionError={connectionError}
          sessionCount={account.sessionCount}
        />
      </div>
    </>
  );
}
