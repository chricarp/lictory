import { Link } from "@lictory/platform/lib/navigation";
import { useRouter } from "@lictory/platform/lib/navigation";
import { useState } from "react";

import {
  FormField,
  FormMessage,
} from "@lictory/platform/components/auth/form-field";
import { PasswordInput } from "@lictory/platform/components/auth/password-field";
import { SecondFactorForm } from "@lictory/platform/components/auth/second-factor-form";
import { Button } from "@lictory/ui/button";
import { authClient } from "@lictory/platform/lib/auth-client";
import { refreshSession } from "@lictory/platform/lib/session";
import { formValue } from "@lictory/core/lib/utils";
import { identifyUser, track } from "@lictory/core/lib/analytics/client";

export function SignInForm({
  callbackURL,
  defaultEmail,
}: {
  callbackURL: string;
  defaultEmail?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [secondFactor, setSecondFactor] = useState(false);

  async function finish(userId: string | undefined) {
    if (userId) identifyUser(userId);
    await refreshSession().catch(() => undefined);
    router.push(callbackURL);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = formValue(formData, "email");
    const password = formValue(formData, "password");
    const rememberMe = formData.get("rememberMe") === "on";

    track("sign_in_submitted", { method: "email" });
    const result = await authClient.signIn.email({
      email,
      password,
      rememberMe,
      callbackURL,
    });

    if (result.error) {
      track("sign_in_failed", {
        method: "email",
        status_code: result.error.status ?? 0,
      });
      // A 403 is an unverified email, unless the server names another
      // reason (a deactivated account).
      setError(
        result.error.status === 403 &&
          (!result.error.code || result.error.code === "EMAIL_NOT_VERIFIED")
          ? "Verify your email before signing in. We sent you a new verification link."
          : (result.error.message ??
              "We could not sign you in with those details."),
      );
      setPending(false);
      return;
    }

    // Accounts with two-factor authentication get no session until the
    // second step succeeds.
    if (result.data && "twoFactorRedirect" in result.data) {
      setSecondFactor(true);
      setPending(false);
      return;
    }

    await finish(result.data?.user.id);
  }

  if (secondFactor)
    return (
      <SecondFactorForm
        onVerified={finish}
        onCancel={() => setSecondFactor(false)}
      />
    );

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormField
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        defaultValue={defaultEmail}
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
