"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormField, FormMessage } from "~/components/auth/form-field";
import { PasswordInput } from "~/components/auth/password-field";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { formValue } from "~/lib/utils";

export function SignInForm({ callbackURL }: { callbackURL: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = formValue(formData, "email");
    const password = formValue(formData, "password");
    const rememberMe = formData.get("rememberMe") === "on";

    const result = await authClient.signIn.email({
      email,
      password,
      rememberMe,
      callbackURL,
    });

    if (result.error) {
      setError(
        result.error.status === 403
          ? "Verify your email before signing in. We sent you a new verification link."
          : (result.error.message ??
              "We could not sign you in with those details."),
      );
      setPending(false);
      return;
    }

    router.push(callbackURL);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
      />
      <PasswordInput
        id="password"
        name="password"
        label="Password"
        autoComplete="current-password"
        required
        hint={
          <Link
            href="/forgot-password"
            className="rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Forgot password?
          </Link>
        }
      />
      <label className="flex min-h-5 cursor-pointer items-center gap-2 text-[13px] text-muted-foreground select-none">
        <input
          type="checkbox"
          name="rememberMe"
          defaultChecked
          className="size-4 rounded border-input accent-primary"
        />
        Keep me signed in
      </label>
      <FormMessage>{error}</FormMessage>
      <Button
        size="lg"
        type="submit"
        className="mt-1 w-full"
        disabled={pending}
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
