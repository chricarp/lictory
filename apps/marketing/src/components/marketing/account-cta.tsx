"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CtaLink } from "@lictory/marketing/components/marketing/cta-link";
import { platformHref } from "@lictory/marketing/lib/platform";
import { useSignedIn } from "@lictory/marketing/lib/signed-in";

// Calls to action that depend on whether the visitor is signed in to the
// application: sign-up and sign-in for visitors, "Open workspace" otherwise.

export const openWorkspaceLabel = "Open workspace";

export function HeaderAccountLinks() {
  const signedIn = useSignedIn();
  if (signedIn)
    return (
      <CtaLink href={platformHref("/")} className="h-9 px-4 shadow-none">
        {openWorkspaceLabel}
      </CtaLink>
    );
  return (
    <>
      <CtaLink
        href={platformHref("/sign-in")}
        variant="ghost"
        className="h-9 px-3.5"
      >
        Log in
      </CtaLink>
      <CtaLink href={platformHref("/sign-up")} className="h-9 px-4 shadow-none">
        Sign up
      </CtaLink>
    </>
  );
}

/** The primary call to action: sign up, or open the workspace when signed in. */
export function StartCta({
  label,
  size = "lg",
  className,
}: {
  label: string;
  size?: "md" | "lg";
  className?: string;
}) {
  const signedIn = useSignedIn();
  return (
    <CtaLink
      href={platformHref(signedIn ? "/" : "/sign-up")}
      size={size}
      className={className}
    >
      {signedIn ? openWorkspaceLabel : label}
      <ArrowRight aria-hidden className="size-4" />
    </CtaLink>
  );
}

/** A secondary sign-in link, hidden when signed in (the primary one opens the workspace). */
export function SignInCta({ className }: { className?: string }) {
  if (useSignedIn()) return null;
  return (
    <CtaLink
      href={platformHref("/sign-in")}
      size="lg"
      variant="secondary"
      className={className}
    >
      Log in
    </CtaLink>
  );
}

export function AccountTextLink({ className }: { className?: string }) {
  const signedIn = useSignedIn();
  return (
    <Link
      href={platformHref(signedIn ? "/" : "/sign-in")}
      className={className}
    >
      {signedIn ? openWorkspaceLabel : "Sign in"}
    </Link>
  );
}
