import type { ReactNode } from "react";

import Link from "next/link";
import { PrivacyPreferencesButton } from "@lictory/ui/consent/consent-ui";
import { LogoMark } from "@lictory/ui/logo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-background px-5 py-10 sm:py-14">
      <div className="lictory-enter flex w-full max-w-[360px] flex-1 flex-col justify-center">
        <Link
          href="/"
          aria-label="Lictory home"
          className="mx-auto mb-8 grid size-10 place-items-center rounded-lg text-foreground transition-transform duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97]"
        >
          <LogoMark className="size-10" />
        </Link>
        {children}
      </div>
      <PrivacyPreferencesButton className="mt-10 rounded text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        Privacy preferences
      </PrivacyPreferencesButton>
    </main>
  );
}

export function AuthHeading({
  title,
  description,
}: {
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="mb-8 text-center">
      <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.02em]">
        {title}
      </h1>
      {description ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function AuthFooter({ children }: { children: ReactNode }) {
  return (
    <p className="mt-8 text-center text-sm leading-6 text-muted-foreground">
      {children}
    </p>
  );
}

export function AuthLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded font-medium text-foreground underline decoration-border underline-offset-[3px] transition-colors duration-100 outline-none hover:decoration-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}
