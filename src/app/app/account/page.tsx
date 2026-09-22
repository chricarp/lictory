import { AccountPage } from "~/components/app/account-page";

// Standalone fallback for people without an organization; inside a workspace
// the same page lives at /app/[org]/account so the sidebar stays in place.
export default function StandaloneAccountPage() {
  return (
    <main className="min-h-dvh">
      <AccountPage />
    </main>
  );
}
