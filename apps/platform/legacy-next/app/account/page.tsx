import type { Metadata } from "next";
import { AccountPage } from "@lictory/platform/components/app/account-page";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string | string[];
    connected?: string | string[];
    error?: string | string[];
  }>;
}) {
  const { returnTo, connected, error } = await searchParams;

  return (
    <main className="min-h-dvh">
      <AccountPage
        returnTo={typeof returnTo === "string" ? returnTo : undefined}
        connected={typeof connected === "string" ? connected : undefined}
        connectionError={typeof error === "string" ? error : undefined}
      />
    </main>
  );
}
