"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/primitives";
export function Invitation({ id }: { id?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <main className="mx-auto max-w-lg p-8">
      <EmptyState
        title="Join your team's workspace"
        action={
          id && (
            <Button
              size="lg"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const result = await authClient.organization.acceptInvitation({
                  invitationId: id,
                });
                setPending(false);
                if (result.error) return setError(result.error.message);
                router.push("/app");
                router.refresh();
              }}
            >
              Accept invitation
            </Button>
          )
        }
      >
        Sign in with the email address your teammate invited, then accept to
        join.
        {error && (
          <p role="alert" className="mt-2 text-destructive">
            {error}
          </p>
        )}
      </EmptyState>
    </main>
  );
}
