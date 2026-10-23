import Link from "next/link";

import { PrivacyPreferencesButton } from "@lictory/ui/consent/consent-ui";
import { Logo } from "@lictory/ui/logo";
import { comparisons } from "@lictory/marketing/content/comparisons";
import { cn } from "@lictory/core/lib/utils";
import { HeaderAccountLinks } from "@lictory/marketing/components/marketing/account-cta";

// Header, footer and calls to action shared by the landing page and the public
// guides and comparisons, so every public page links to the others.

/**
 * `sections` prefixes the landing page's section anchors: empty on the landing
 * page itself, "/" elsewhere.
 */
export function MarketingHeader({ sections = "" }: { sections?: string }) {
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
        <Logo className="[&>span]:h-5" />
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
          <HeaderAccountLinks />
        </div>
      </div>
    </header>
  );
}

const footerLinkClass = "hover:text-foreground";

export function MarketingFooter({ sections = "" }: { sections?: string }) {
  return (
    <footer
      data-cta-anchor
      className="border-t border-white/6 px-5 py-10 sm:px-8"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 text-[13px] text-muted-foreground sm:flex-row sm:items-start">
        <Logo className="text-foreground [&>span]:h-6" />
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
