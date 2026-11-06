import Link from "next/link";

import { PrivacyPreferencesButton } from "@lictory/ui/consent/consent-ui";
import { Logo } from "@lictory/ui/logo";
import { comparisons } from "@lictory/marketing/content/comparisons";
import { cn } from "@lictory/core/lib/utils";

// Shared footer for the landing page, guides and comparisons.

const footerLinkClass = "hover:text-foreground";

/** Site footer; section links point home when it appears on an article. */
export function MarketingFooter({ sections = "" }: { sections?: string }) {
  return (
    <footer className="marketing-footer border-t border-border py-12">
      <div className="site-width flex flex-col gap-8 text-sm text-muted-foreground sm:flex-row sm:items-start">
        <Logo className="text-foreground [&>span]:h-6" />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-12 gap-y-6">
          <div className="flex flex-col gap-2">
            <Link href={`${sections}#features`} className={footerLinkClass}>
              Features
            </Link>
            <Link href={`${sections}#open-source`} className={footerLinkClass}>
              Open source
            </Link>
            <Link href={`${sections}#delivery`} className={footerLinkClass}>
              Delivery
            </Link>
            <Link href={`${sections}#spaces`} className={footerLinkClass}>
              Spaces
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
