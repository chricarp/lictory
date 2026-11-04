import type { ReactNode } from "react";

import { Link } from "@lictory/platform/lib/navigation";
import { siteUrl } from "@lictory/platform/lib/site";
import { PrivacyPreferencesButton } from "@lictory/ui/consent/consent-ui";
import { LogoMark } from "@lictory/ui/logo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-shell [background-image:var(--hatch)] px-4 py-10 sm:py-14">
      <div className="lictory-enter flex w-full max-w-[400px] flex-1 flex-col justify-center">
        <a
          href={siteUrl}
          aria-label="Lictory home"
          className="mx-auto mb-7 grid size-10 place-items-center rounded-lg text-foreground transition-transform duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97]"
        >
          <LogoMark className="size-9" />
        </a>
        <div className="rounded-[1.75rem] bg-card px-6 py-8 shadow-(--shadow-panel) sm:px-8">
          {children}
        </div>
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
    <div className="mb-7 text-center">
      <h1 className="text-2xl leading-8 font-semibold tracking-[-0.025em] text-balance">
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
    <p className="mt-7 text-center text-sm leading-6 text-muted-foreground">
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
