import Link from "next/link";
import type { ReactNode } from "react";

import { PrivacyPreferencesButton } from "@lictory/ui/consent/consent-ui";
import { Logo } from "@lictory/ui/logo";
import { comparisons } from "@lictory/marketing/content/comparisons";
import { cn } from "@lictory/core/lib/utils";

// Header, footer and calls to action shared by the landing page and the public
// guides and comparisons, so every public page links to the others.

const linkBase =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-150 ease-out outline-none focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.98]";

export function CtaLink({
  href,
  children,
  variant = "primary",
  size = "md",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        linkBase,
        size === "md" && "h-8 px-3 text-[13px]",
        size === "lg" && "h-11 px-5 text-sm",
        variant === "primary" &&
          "bg-foreground text-background shadow-[0_0_0_1px_oklch(1_0_0/0.1),0_8px_30px_-8px_oklch(0.75_0.12_285/0.55)] hover:bg-foreground/90",
        variant === "secondary" &&
          "bg-white/4 text-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.1)] hover:bg-white/8",
        variant === "ghost" &&
          "text-muted-foreground hover:bg-white/5 hover:text-foreground",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/**
 * `sections` prefixes the landing page's section anchors: empty on the landing
 * page itself, "/" elsewhere.
 */
export function MarketingHeader({
  home,
  signedIn,
  sections = "",
}: {
  home: string;
  signedIn: boolean;
  sections?: string;
}) {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-3 sm:top-4">
      <div
        className={cn(
          "pointer-events-auto relative isolate flex h-12 w-full max-w-3xl items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4",
          // Liquid glass: translucent tint, heavy blur + saturation, inner highlight rim.
          "bg-[linear-gradient(180deg,oklch(1_0_0/0.09),oklch(1_0_0/0.03))] backdrop-blur-2xl backdrop-saturate-[1.8]",
          "shadow-[inset_0_1px_0_oklch(1_0_0/0.18),inset_0_-1px_0_oklch(1_0_0/0.04),inset_0_0_0_1px_oklch(1_0_0/0.08),0_8px_32px_-8px_oklch(0_0_0/0.6),0_2px_6px_-2px_oklch(0_0_0/0.4)]",
          "before:pointer-events-none before:absolute before:inset-x-6 before:top-0 before:-z-10 before:h-1/2 before:rounded-t-full before:bg-[radial-gradient(60%_100%_at_50%_0%,oklch(1_0_0/0.12),transparent)]",
        )}
      >
        <Logo href={home} className="[&>span]:h-5" />
        <nav
          aria-label="Sections"
          className="mx-auto hidden items-center text-[13px] md:flex"
        >
          {[
            ["Product", `${sections}#features`],
            ["Readiness", `${sections}#readiness`],
            ["Delivery", `${sections}#delivery`],
            ["Guides", "/guides"],
            ["FAQ", `${sections}#faq`],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href!}
              className="rounded-full px-3 py-1.5 text-foreground/65 transition-[background-color,color] duration-150 hover:bg-white/[0.07] hover:text-foreground"
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          {signedIn ? (
            <CtaLink href="/app" className="h-9 px-4 shadow-none">
              Open Lictory
            </CtaLink>
          ) : (
            <>
              <CtaLink
                href="/sign-in"
                variant="ghost"
                className="h-9 px-3.5 hover:bg-white/[0.07]"
              >
                Log in
              </CtaLink>
              <CtaLink href="/sign-up" className="h-9 px-4 shadow-none">
                Sign up
              </CtaLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const footerLinkClass = "hover:text-foreground";

export function MarketingFooter({
  home,
  sections = "",
}: {
  home: string;
  sections?: string;
}) {
  return (
    <footer
      data-cta-anchor
      className="border-t border-white/6 px-5 py-10 sm:px-8"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 text-[13px] text-muted-foreground sm:flex-row sm:items-start">
        <Logo href={home} className="text-foreground [&>span]:h-6" />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-12 gap-y-6">
          <div className="flex flex-col gap-2">
            <Link href={`${sections}#features`} className={footerLinkClass}>
              Features
            </Link>
            <Link href={`${sections}#delivery`} className={footerLinkClass}>
              Delivery
            </Link>
            <Link href={`${sections}#faq`} className={footerLinkClass}>
              FAQ
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {comparisons.map((comparison) => (
              <Link
                key={comparison.slug}
                href={`/compare/${comparison.slug}`}
                className={footerLinkClass}
              >
                Lictory vs {comparison.competitor}
              </Link>
            ))}
            <Link href="/guides" className={footerLinkClass}>
              Guides
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            <Link href="/privacy" className={footerLinkClass}>
              Privacy Notice
            </Link>
            <Link href="/terms-of-service" className={footerLinkClass}>
              Terms of Service
            </Link>
            <PrivacyPreferencesButton
              className={cn(footerLinkClass, "text-left")}
            >
              Privacy preferences
            </PrivacyPreferencesButton>
          </div>
        </nav>
        <p className="sm:ml-auto">© {new Date().getFullYear()} Lictory</p>
      </div>
    </footer>
  );
}
