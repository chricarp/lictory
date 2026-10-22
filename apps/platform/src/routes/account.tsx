import { AccountPage } from "@lictory/platform/components/app/account-page";
import { useSearchParams } from "@lictory/platform/lib/navigation";
import { PageTitle } from "@lictory/platform/routes/title";

export function AccountRoute() {
  const params = useSearchParams();
  return (
    <main className="min-h-dvh">
      <PageTitle title="Account" />
      <AccountPage
        returnTo={params.get("returnTo") ?? undefined}
        connected={params.get("connected") ?? undefined}
        connectionError={params.get("error") ?? undefined}
      />
    </main>
  );
}
