"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormField, FormMessage } from "@lictory/platform/components/auth/form-field";
import { NewPasswordFields } from "@lictory/platform/components/auth/password-field";
import { Button } from "@lictory/ui/button";
import { authClient } from "@lictory/platform/lib/auth-client";
import { formValue } from "@lictory/core/lib/utils";
import { identifyUser, track } from "@lictory/core/lib/analytics/client";

export function SignUpForm({ callbackURL = "/app" }: { callbackURL?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = formValue(formData, "password");

    setPending(true);
    const email = formValue(formData, "email");
    track("sign_up_submitted", { method: "email" });
    const result = await authClient.signUp.email({
      name: formValue(formData, "name"),
      email,
      password,
      callbackURL: `/verify-email?verified=1&callbackUrl=${encodeURIComponent(callbackURL)}`,
    });

    if (result.error) {
      track("sign_up_failed", {
        method: "email",
        status_code: result.error.status ?? 0,
      });
      setError(result.error.message ?? "We could not create your account.");
      setPending(false);
      return;
    }

    if (result.data?.user.id) identifyUser(result.data.user.id);

    router.push(
      `/verify-email?email=${encodeURIComponent(email)}&callbackUrl=${encodeURIComponent(callbackURL)}`,
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormField
        id="name"
        name="name"
        label="Full name"
        autoComplete="name"
        placeholder="Alex Morgan"
        required
      />
      <FormField
        id="email"
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
      />
      <NewPasswordFields confirm={false} />
      <FormMessage>{error}</FormMessage>
      <Button
        size="lg"
        type="submit"
        className="mt-1 w-full"
        disabled={pending}
      >
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
