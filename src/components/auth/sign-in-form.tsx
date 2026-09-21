"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormField, FormMessage } from "~/components/auth/form-field";
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
    <form onSubmit={onSubmit} className="grid gap-5">
      <FormField
        id="email"
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
      />
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Link
            href="/forgot-password"
            className="rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            Forgot password?
          </Link>
        </div>
        <FormField
          id="password"
          name="password"
          label=""
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <label className="flex min-h-6 cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="rememberMe"
          defaultChecked
          className="size-4 rounded border-input accent-primary"
        />
        Keep me signed in
      </label>
      <FormMessage>{error}</FormMessage>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
