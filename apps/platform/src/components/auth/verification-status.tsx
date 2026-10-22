import { useState } from "react";
import { Link } from "@lictory/platform/lib/navigation";

import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "@lictory/platform/components/auth/auth-layout";
import { FormMessage } from "@lictory/platform/components/auth/form-field";
import { Button } from "@lictory/ui/button";
import { authClient } from "@lictory/platform/lib/auth-client";
import { track } from "@lictory/core/lib/analytics/client";

export function VerificationStatus({
  email,
  verified,
  errorCode,
  callbackURL = "/",
}: {
  email?: string;
  verified: boolean;
  errorCode?: string;
  callbackURL?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function resend() {
    if (!email) return;
    setPending(true);
    const result = await authClient.sendVerificationEmail({
      email,
      callbackURL: `/verify-email?verified=1&callbackUrl=${encodeURIComponent(callbackURL)}`,
    });
    if (!result.error) track("verification_email_requested");
    setMessage(
      result.error
        ? (result.error.message ?? "We could not resend the email.")
        : "A fresh verification link is on its way.",
    );
    setPending(false);
  }

  if (verified && !errorCode) {
    return (
      <>
        <AuthHeading title="Email verified" />
        <Link href={callbackURL} className="contents">
          <Button size="lg" className="w-full">
            Open workspace
          </Button>
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading
        title={errorCode ? "Verification link expired" : "Check your inbox"}
        description={
          errorCode ? (
            "Request a fresh link to finish verifying your email."
          ) : (
            <>
              We sent a verification link to{" "}
              {email ? (
                <span className="font-medium text-foreground">{email}</span>
              ) : (
                "your email"
              )}
              .
            </>
          )
        }
      />
      <div className="grid gap-4">
        <FormMessage
          tone={message?.startsWith("A fresh") ? "success" : "error"}
        >
          {message}
        </FormMessage>
        {email ? (
          <Button
            size="lg"
            variant="secondary"
            className="w-full"
            onClick={resend}
            disabled={pending}
          >
            {pending ? "Sending…" : "Resend verification email"}
          </Button>
        ) : null}
      </div>
      <AuthFooter>
        <AuthLink
          href={`/sign-in?callbackUrl=${encodeURIComponent(callbackURL)}`}
        >
          Back to sign in
        </AuthLink>
      </AuthFooter>
    </>
  );
}
