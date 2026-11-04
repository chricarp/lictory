import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Wordmark } from "@lictory/docs/components/wordmark";
import { site } from "@lictory/docs/lib/site";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Wordmark /> },
    githubUrl: site.repository,
    links: [
      { text: "Website", url: site.website, external: true },
      // The websites' own notices (lictory.com operator), not an installation's.
      { text: "Privacy", url: `${site.website}/privacy`, external: true },
      {
        text: "Terms",
        url: `${site.website}/terms-of-service`,
        external: true,
      },
    ],
  };
}
