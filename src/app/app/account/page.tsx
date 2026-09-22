import type { Metadata } from "next";
import { AccountPage } from "~/components/app/account-page";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { returnTo } = await searchParams;

  return (
    <main className="min-h-dvh">
      <AccountPage
        returnTo={typeof returnTo === "string" ? returnTo : undefined}
      />
    </main>
  );
}
