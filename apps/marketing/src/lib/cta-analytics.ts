import { track } from "@lictory/core/lib/analytics/client";

// Which call to action a visitor followed, and where on the page it was. The
// destinations are outbound (docs, GitHub), so this is the website's conversion
// signal. Without analytics settings or PostHog, `track` does nothing.

export type CtaTracking = {
  cta: "get_started" | "github";
  placement: "header" | "hero" | "final" | "open_source";
};

export function trackCtaClick({ cta, placement }: CtaTracking, href: string) {
  track("cta_clicked", { cta, placement, href });
}
