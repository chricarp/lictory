"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormField, FormMessage } from "~/components/auth/form-field";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { formValue } from "~/lib/utils";

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const password = formValue(formData, "password");
    const confirmation = formValue(formData, "confirmation");

    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setPending(true);
    const email = formValue(formData, "email");
    const result = await authClient.signUp.email({
      name: formValue(formData, "name"),
      email,
      password,
      callbackURL: "/verify-email?verified=1",
    });

    if (result.error) {
      setError(result.error.message ?? "We could not create your account.");
      setPending(false);
      return;
    }

    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
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
      <FormField
        id="password"
        name="password"
        label="Password"
        hint="10 characters minimum"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      <FormField
        id="confirmation"
        name="confirmation"
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      <FormMessage>{error}</FormMessage>
      <Button size="lg" type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        By creating an account, you agree to keep your organization&apos;s
        information secure.
      </p>
    </form>
  );
}
