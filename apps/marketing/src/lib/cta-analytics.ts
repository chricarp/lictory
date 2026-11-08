import { track } from "@lictory/core/lib/analytics/client";

// Which call to action a visitor followed, where on the page it was, and which
// kind of page they were reading. The destinations are outbound (docs, GitHub),
// so this is the website's conversion signal. Without analytics settings or
// PostHog, `track` does nothing.

/** The kind of public page a call to action sits on. */
export type CtaPageType =
  "home" | "guide" | "comparison" | "alternatives" | "roundup" | "legal";

export type CtaTracking = {
  cta: "get_started" | "github";
  placement: "header" | "hero" | "final" | "open_source";
  page: CtaPageType;
};

export function trackCtaClick(
  { cta, placement, page }: CtaTracking,
  href: string,
) {
  track("cta_clicked", { cta, placement, page_type: page, href });
}
