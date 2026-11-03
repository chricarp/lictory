import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Wordmark } from "@lictory/docs/components/wordmark";
import { site } from "@lictory/docs/lib/site";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <Wordmark /> },
    githubUrl: site.repository,
    links: [{ text: "Website", url: site.website, external: true }],
  };
}
