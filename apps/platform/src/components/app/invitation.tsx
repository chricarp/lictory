import { useEffect, useState } from "react";
import { useRouter } from "@lictory/platform/lib/navigation";
import { Link } from "@lictory/platform/lib/navigation";
import { authClient } from "@lictory/platform/lib/auth-client";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import {
  OnboardingFrame,
  OnboardingHeading,
} from "@lictory/platform/components/workspace/onboarding-frame";

export function Invitation({ id }: { id?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [details, setDetails] = useState<{
    organizationName: string;
    email: string;
    organizationSlug: string;
  }>();
  useEffect(() => {
    let cancelled = false;
    if (id)
      void authClient.organization
        .getInvitation({ query: { id } })
        .then((result) => {
          if (cancelled) return;
          if (result.error)
            setError(
              result.error.message ??
                "This invitation is unavailable. Ask your administrator for a new link.",
            );
          else setDetails(result.data);
        })
        .catch(() => {
          if (!cancelled)
            setError(
              "Could not load this invitation. Check your connection and reload.",
            );
        });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return (
    <OnboardingFrame>
      <OnboardingHeading
        title={
          details
            ? `Join ${details.organizationName}`
            : "Join your team’s workspace"
        }
      >
        {details ? (
          <>
            Invited as{" "}
            <span className="font-medium text-foreground">{details.email}</span>
            . Everything is already set up.
          </>
        ) : (
          "Sign in with the email address your teammate invited."
        )}
      </OnboardingHeading>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {id && details && (
        <Button
          size="lg"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(undefined);
            try {
              const result = await authClient.organization.acceptInvitation({
                invitationId: id,
              });
              if (result.error) throw new Error(result.error.message);
              router.push(paths.org(details.organizationSlug));
            } catch (e) {
              setError(
                e instanceof Error
                  ? e.message
                  : "Could not accept invitation. Try again.",
              );
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Joining…" : "Accept invitation"}
        </Button>
      )}
      <Link
        href="/?intent=join"
        className="mt-6 block text-sm text-muted-foreground hover:text-foreground"
      >
        Other options
      </Link>
    </OnboardingFrame>
  );
}
