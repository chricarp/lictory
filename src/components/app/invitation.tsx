"use client";
import { useRouter } from "next/navigation";
import { authClient } from "~/lib/auth-client";
import { ActionForm, EmptyState } from "~/components/ui/workspace";
export function Invitation({ id }: { id?: string }) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-lg p-8">
      <EmptyState title="Join your team's workspace">
        Sign in with the email address your teammate invited, then accept to
        join.
      </EmptyState>
      {id && (
        <div className="mt-6">
          <ActionForm
            label="Accept invitation"
            submit={async () => {
              const result = await authClient.organization.acceptInvitation({
                invitationId: id,
              });
              if (result.error) throw new Error(result.error.message);
              router.push("/app");
              router.refresh();
            }}
          >
            {null}
          </ActionForm>
        </div>
      )}
    </main>
  );
}
