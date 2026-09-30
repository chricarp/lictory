"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { track } from "~/lib/analytics/client";

type Provider = "google" | "microsoft";
type ProviderState = Record<Provider, boolean>;

const providerMeta: Record<
  Provider,
  { label: string; icon: () => React.JSX.Element }
> = {
  google: { label: "Google", icon: GoogleIcon },
  microsoft: { label: "Microsoft", icon: MicrosoftIcon },
};

export function SocialButtons({
  providers,
  callbackURL,
}: {
  providers: ProviderState;
  callbackURL: string;
}) {
  const [pending, setPending] = useState<Provider | null>(null);
  const enabled = (Object.keys(providerMeta) as Provider[]).filter(
    (provider) => providers[provider],
  );

  if (enabled.length === 0) return null;

  async function signIn(provider: Provider) {
    setPending(provider);
    track("social_sign_in_started", { provider });
    await authClient.signIn.social({ provider, callbackURL });
    setPending(null);
  }

  return (
    <>
      <div className="grid gap-2.5">
        {enabled.map((provider) => {
          const { label, icon: Icon } = providerMeta[provider];
          return (
            <Button
              key={provider}
              size="lg"
              variant="secondary"
              className="w-full gap-2.5"
              disabled={pending !== null}
              onClick={() => signIn(provider)}
            >
              <Icon />
              {pending === provider ? "Redirecting…" : `Continue with ${label}`}
            </Button>
          );
        })}
      </div>
      <AuthDivider />
    </>
  );
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path
        fill="#4285F4"
        d="M22.6 12.2c0-.7-.1-1.5-.2-2.2H12v4.3h6a5.2 5.2 0 0 1-2.2 3.3v2.8h3.6c2.1-2 3.2-4.8 3.2-8.2Z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.6-1 7.4-2.6l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1a6.5 6.5 0 0 1-6.1-4.5H2.2V17A11.2 11.2 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.9 14.2a6.7 6.7 0 0 1 0-4.3V7H2.2a11.2 11.2 0 0 0 0 10l3.7-2.8Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.3c1.7 0 3.2.6 4.4 1.7l3.1-3A10.5 10.5 0 0 0 2.2 7l3.7 2.9A6.5 6.5 0 0 1 12 5.3Z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4">
      <path fill="#f25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7fba00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00a4ef" d="M2 12.5h9.5V22H2z" />
      <path fill="#ffb900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
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
