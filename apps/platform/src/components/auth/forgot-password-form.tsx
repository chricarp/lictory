import { useState } from "react";

import { FormField, FormMessage } from "@lictory/platform/components/auth/form-field";
import { Button } from "@lictory/ui/button";
import { authClient } from "@lictory/platform/lib/auth-client";
import { track } from "@lictory/core/lib/analytics/client";
import { formValue } from "@lictory/core/lib/utils";

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

    track("password_reset_requested");
    setSent(true);
    setPending(false);
  }

  if (sent) {
    return (
      <div className="grid gap-4">
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
    <form onSubmit={onSubmit} className="grid gap-4">
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
      <Button
        size="lg"
        type="submit"
        className="mt-1 w-full"
        disabled={pending}
      >
        {pending ? "Sending link…" : "Send reset link"}
      </Button>
    </form>
  );
}
