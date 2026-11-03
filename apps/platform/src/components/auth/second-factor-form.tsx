import { useEffect, useState } from "react";

import {
  FormField,
  FormMessage,
} from "@lictory/platform/components/auth/form-field";
import { Button } from "@lictory/ui/button";
import { authClient } from "@lictory/platform/lib/auth-client";
import { formValue } from "@lictory/core/lib/utils";

// The second step of a password sign-in for accounts with two-factor
// authentication: a code from the authenticator app, or one of the backup
// codes. Better Auth keeps the pending sign-in in a short-lived cookie; the
// session only exists once a code is accepted.
export function SecondFactorForm({
  onVerified,
  onCancel,
}: {
  onVerified: (userId: string | undefined) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<"totp" | "backup">("totp");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputId = method === "totp" ? "two-factor-code" : "backup-code";

  // Move focus to the code field when the step or method changes.
  useEffect(() => {
    document.getElementById(inputId)?.focus();
  }, [inputId]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const code = formValue(new FormData(event.currentTarget), "code").replace(
      /\s+/g,
      "",
    );
    const result =
      method === "totp"
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });
    if (result.error) {
      setError(
        result.error.code === "INVALID_TWO_FACTOR_COOKIE" ||
          result.error.code === "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE"
          ? "This sign-in expired or had too many attempts. Start over with your email and password."
          : method === "totp"
            ? "That code is not valid. Enter the current 6-digit code from your authenticator app."
            : "That backup code is not valid or was already used.",
      );
      setPending(false);
      return;
    }
    await onVerified(result.data?.user?.id);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" key={method}>
      <p className="text-[13px] leading-5 text-muted-foreground">
        {method === "totp"
          ? "Your account uses two-factor authentication. Enter the code from your authenticator app."
          : "Enter one of the backup codes you saved when you turned on two-factor authentication. Each code works once."}
      </p>
      {method === "totp" ? (
        <FormField
          id="two-factor-code"
          name="code"
          label="Authentication code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
        />
      ) : (
        <FormField
          id="backup-code"
          name="code"
          label="Backup code"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          required
        />
      )}
      <FormMessage>{error}</FormMessage>
      <Button size="lg" type="submit" className="w-full" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <button
          type="button"
          className="rounded text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setError(null);
            setMethod(method === "totp" ? "backup" : "totp");
          }}
        >
          {method === "totp"
            ? "Use a backup code instead"
            : "Use your authenticator app instead"}
        </button>
        <button
          type="button"
          className="rounded text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onCancel}
        >
          Start over
        </button>
      </div>
    </form>
  );
}
