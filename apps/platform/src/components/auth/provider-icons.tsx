import { Building2 } from "lucide-react";

// "oidc" is the installation's company identity provider (single sign-on),
// named by the operator.
export type SocialProvider = "oidc" | "google" | "microsoft";

export const socialProviders = ["oidc", "google", "microsoft"] as const;

const providerLabels: Record<SocialProvider, string> = {
  oidc: "SSO",
  google: "Google",
  microsoft: "Microsoft",
};

export function providerLabel(
  provider: SocialProvider,
  ssoName?: string | null,
) {
  return provider === "oidc" && ssoName ? ssoName : providerLabels[provider];
}

export const isSocialProvider = (value: string): value is SocialProvider =>
  Object.hasOwn(providerLabels, value);

export function ProviderIcon({
  provider,
  className = "size-4",
}: {
  provider: SocialProvider;
  className?: string;
}) {
  if (provider === "oidc")
    return <Building2 aria-hidden="true" className={className} />;
  if (provider === "google")
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
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
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className}>
      <path fill="#f25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7fba00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00a4ef" d="M2 12.5h9.5V22H2z" />
      <path fill="#ffb900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}
