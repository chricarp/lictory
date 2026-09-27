"use client";

import Link from "next/link";
import { useState } from "react";

import { FormMessage } from "~/components/auth/form-field";
import { NewPasswordFields } from "~/components/auth/password-field";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { formValue } from "~/lib/utils";

export function ResetPasswordForm({ token }: { token?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!token) {
      setError(
        "This reset link is missing its security token. Request a new one.",
      );
      return;
    }

    const formData = new FormData(event.currentTarget);
    const password = formValue(formData, "password");
    if (password !== formValue(formData, "confirmation")) {
      setError("The passwords do not match.");
      return;
    }

    setPending(true);
    const result = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    if (result.error) {
      setError(
        result.error.message ?? "This reset link is invalid or expired.",
      );
      setPending(false);
      return;
    }

    setComplete(true);
  }

  if (complete) {
    return (
      <div className="grid gap-4">
        <FormMessage tone="success">
          Your password has been updated.
        </FormMessage>
        <Link href="/sign-in" className="contents">
          <Button size="lg" className="w-full">
            Continue to sign in
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <NewPasswordFields
        autoFocus
        passwordLabel="New password"
        confirmationLabel="Confirm new password"
      />
      <FormMessage>{error}</FormMessage>
      <Button
        size="lg"
        type="submit"
        className="w-full"
        disabled={pending || !token}
      >
        {pending ? "Updating password…" : "Update password"}
      </Button>
    </form>
  );
}
