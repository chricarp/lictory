"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import {
  OnboardingFrame,
  OnboardingHeading,
} from "~/components/workspace/onboarding-frame";

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
    <OnboardingFrame stage={1}>
      <OnboardingHeading
        title={
          details
            ? `Join ${details.organizationName}`
            : "Join your team’s workspace"
        }
      >
        Lictory brings product, engineering, and QA together to refine
        proposals, review revisions, and agree on implementation-ready
        specifications. Your organization’s projects and delivery choices are
        already configured.
      </OnboardingHeading>
      <div className="rounded-xl border bg-card p-5 text-sm leading-relaxed text-muted-foreground">
        {details ? (
          <>
            This invitation is for{" "}
            <strong className="text-foreground">{details.email}</strong>.
            Accepting gives you access to{" "}
            <strong className="text-foreground">
              {details.organizationName}
            </strong>
            . Your administrator manages your roles and team membership.
          </>
        ) : (
          "Sign in with the email address your teammate invited. Your administrator can share an invitation link with you."
        )}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {id && details && (
        <Button
          className="mt-6"
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
              router.push(`/app/${details.organizationSlug}`);
              router.refresh();
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
        href="/app?intent=join"
        className="mt-6 block text-sm text-muted-foreground hover:text-foreground"
      >
        See my invitations and workspace options
      </Link>
    </OnboardingFrame>
  );
}
