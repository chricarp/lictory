"use client";

import { useState } from "react";

import { FormField, FormMessage } from "~/components/auth/form-field";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { formValue } from "~/lib/utils";

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const email = formValue(new FormData(event.currentTarget), "email");

    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });

    if (result.error) {
      setError(result.error.message ?? "We could not send the reset email.");
      setPending(false);
      return;
    }

    setSent(true);
    setPending(false);
  }

  if (sent) {
    return (
      <div className="grid gap-5">
        <FormMessage tone="success">
          If an account exists for that address, a password reset link is on its
          way.
        </FormMessage>
        <Button
          size="lg"
          variant="secondary"
          className="w-full"
          onClick={() => setSent(false)}
        >
          Send to another address
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormField
        id="email"
        name="email"
        label="Account email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        autoFocus
      />
      <FormMessage>{error}</FormMessage>
      <Button size="lg" type="submit" className="w-full" disabled={pending}>
        {pending ? "Sending link…" : "Send reset link"}
      </Button>
    </form>
  );
}
