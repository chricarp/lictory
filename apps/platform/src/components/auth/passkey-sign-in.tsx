import { useState } from "react";
import { Fingerprint } from "lucide-react";

import { FormMessage } from "@lictory/platform/components/auth/form-field";
import { Button } from "@lictory/ui/button";
import { authClient } from "@lictory/platform/lib/auth-client";
import { useRouter } from "@lictory/platform/lib/navigation";
import { refreshSession } from "@lictory/platform/lib/session";
import { identifyUser, track } from "@lictory/core/lib/analytics/client";

// Better Auth error codes, when the error carries one.
const errorCode = (error: object) => (error as { code?: string }).code;

// Signs in with a passkey added in Account settings → Security. Shown only in
// browsers with WebAuthn; the browser asks which passkey to use.
export function PasskeySignIn({ callbackURL }: { callbackURL: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (typeof window.PublicKeyCredential !== "function") return null;

  async function signIn() {
    setPending(true);
    setError(null);
    track("sign_in_submitted", { method: "passkey" });
    const result = await authClient.signIn.passkey();
    if (result?.error) {
      track("sign_in_failed", {
        method: "passkey",
        status_code: result.error.status ?? 0,
      });
      setError(
        errorCode(result.error) === "AUTH_CANCELLED" ||
          errorCode(result.error) === "ERROR_CEREMONY_ABORTED"
          ? "Passkey sign-in was cancelled."
          : "That passkey is not registered on Lictory. Sign in another way and add it in Account settings.",
      );
      setPending(false);
      return;
    }
    const userId = (result?.data as { user?: { id?: string } } | null)?.user
      ?.id;
    if (userId) identifyUser(userId);
    await refreshSession().catch(() => undefined);
    router.push(callbackURL);
  }

  return (
    <div className="grid gap-2.5">
      <FormMessage>{error}</FormMessage>
      <Button
        size="lg"
        variant="secondary"
        className="w-full gap-2.5"
        disabled={pending}
        onClick={signIn}
      >
        <Fingerprint aria-hidden className="size-4" />
        {pending ? "Waiting for your passkey…" : "Sign in with a passkey"}
      </Button>
    </div>
  );
}
