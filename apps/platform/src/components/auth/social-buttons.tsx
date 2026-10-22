"use client";

import { useEffect, useState } from "react";

import { FormMessage } from "@lictory/platform/components/auth/form-field";
import {
  ProviderIcon,
  providerLabels,
  socialProviders,
  type SocialProvider,
} from "@lictory/platform/components/auth/provider-icons";
import { Button } from "@lictory/ui/button";
import { authClient } from "@lictory/platform/lib/auth-client";
import { track } from "@lictory/core/lib/analytics/client";
import { oauthErrorMessage } from "@lictory/core/lib/oauth-errors";

export function SocialButtons({
  providers,
  callbackURL,
  errorCallbackURL,
  error,
}: {
  providers: Record<SocialProvider, boolean>;
  callbackURL: string;
  // Where the provider sends people back when sign-in fails, with `?error=`.
  errorCallbackURL: string;
  error?: string;
}) {
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [failure, setFailure] = useState<string | null>(
    oauthErrorMessage(error, "sign-in"),
  );
  const enabled = socialProviders.filter((provider) => providers[provider]);

  // Coming back from the provider with the browser's Back button restores
  // this page from cache; let the buttons be used again.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  if (enabled.length === 0) return null;

  async function signIn(provider: SocialProvider) {
    setPending(provider);
    setFailure(null);
    track("social_sign_in_started", { provider });
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL,
        errorCallbackURL,
      });
      // On success the browser is already leaving for the provider.
      if (!result.error) return;
    } catch {
      // Network failures should leave both sign-in methods available to retry.
    }
    setFailure(
      `We couldn't reach ${providerLabels[provider]}. Check your connection and try again.`,
    );
    setPending(null);
  }

  return (
    <>
      <div className="grid gap-2.5">
        <FormMessage>{failure}</FormMessage>
        {enabled.map((provider) => (
          <Button
            key={provider}
            size="lg"
            variant="secondary"
            className="w-full gap-2.5 transition-[background-color,color,box-shadow,transform] active:scale-[0.98] motion-reduce:transition-none"
            disabled={pending !== null}
            onClick={() => signIn(provider)}
          >
            <ProviderIcon provider={provider} />
            {pending === provider
              ? `Redirecting to ${providerLabels[provider]}…`
              : `Continue with ${providerLabels[provider]}`}
          </Button>
        ))}
      </div>
      <span role="status" className="sr-only">
        {pending ? `Redirecting to ${providerLabels[pending]}…` : ""}
      </span>
      <AuthDivider />
    </>
  );
}

function AuthDivider() {
  return (
    <div
      role="separator"
      className="my-6 flex items-center gap-3 text-xs text-muted-foreground"
    >
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
