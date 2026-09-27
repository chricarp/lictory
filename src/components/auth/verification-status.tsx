"use client";

import { useState } from "react";
import Link from "next/link";

import {
  AuthFooter,
  AuthHeading,
  AuthLink,
} from "~/components/auth/auth-layout";
import { FormMessage } from "~/components/auth/form-field";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";

export function VerificationStatus({
  email,
  verified,
  errorCode,
}: {
  email?: string;
  verified: boolean;
  errorCode?: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function resend() {
    if (!email) return;
    setPending(true);
    const result = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/verify-email?verified=1",
    });
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
        <AuthHeading
          title="Email verified"
          description="Your account is ready. Continue into your workspace."
        />
        <Link href="/app" className="contents">
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
        <AuthLink href="/sign-in">Back to sign in</AuthLink>
      </AuthFooter>
    </>
  );
}
