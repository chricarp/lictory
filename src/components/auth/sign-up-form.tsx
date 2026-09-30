"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormField, FormMessage } from "~/components/auth/form-field";
import { NewPasswordFields } from "~/components/auth/password-field";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { formValue } from "~/lib/utils";
import { identifyUser, track } from "~/lib/analytics/client";

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
    track("sign_up_submitted", { method: "email" });
    const result = await authClient.signUp.email({
      name: formValue(formData, "name"),
      email,
      password,
      callbackURL: "/verify-email?verified=1",
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

    router.push(`/verify-email?email=${encodeURIComponent(email)}`);
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
      <NewPasswordFields />
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
