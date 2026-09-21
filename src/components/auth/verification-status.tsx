"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Mail } from "lucide-react";

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
      <div className="grid gap-6 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-600">
          <CheckCircle2 className="size-7" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Email verified
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your account is ready. Continue into your protected workspace.
          </p>
        </div>
        <Link href="/app" className="contents">
          <Button size="lg" className="w-full">
            Open workspace
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6 text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Mail className="size-7" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {errorCode ? "Verification link expired" : "Check your inbox"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {errorCode
            ? "Request a fresh link to finish verifying your email."
            : `We sent a verification link${email ? ` to ${email}` : " to your email"}.`}
        </p>
      </div>
      <FormMessage tone={message?.startsWith("A fresh") ? "success" : "error"}>
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
      <Link
        href="/sign-in"
        className="text-sm font-medium text-primary hover:underline"
      >
        Back to sign in
      </Link>
    </div>
  );
}
