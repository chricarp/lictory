import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { PrivacyPreferencesButton } from "@lictory/ui/consent/consent-ui";

import { Wordmark } from "@lictory/docs/components/wordmark";
import { site } from "@lictory/docs/lib/site";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Wordmark /> },
    githubUrl: site.repository,
    links: [{ text: "Website", url: site.website, external: true }],
  };
}

// The websites' own notices (lictory.com operator), not an installation's.
export function LegalLinks() {
  return (
    <p className="text-fd-muted-foreground flex gap-4 px-1 pt-1 text-xs">
      <a className="hover:text-fd-foreground" href={`${site.website}/privacy`}>
        Privacy
      </a>
      <a
        className="hover:text-fd-foreground"
        href={`${site.website}/terms-of-service`}
      >
        Terms
      </a>
      {/* Hidden unless the build carries analytics settings. */}
      <PrivacyPreferencesButton className="hover:text-fd-foreground">
        Privacy preferences
      </PrivacyPreferencesButton>
    </p>
  );
}
