import { track } from "@lictory/core/lib/analytics/client";

// Which call to action a visitor followed, where on the page it was, and which
// kind of page they were reading. The destinations are outbound (docs, GitHub,
// and the release files lictory.com/download links to), so this is the
// website's conversion signal; a download's `href` names the file. Without
// analytics settings or PostHog, `track` does nothing.

/** The kind of public page a call to action sits on. */
export type CtaPageType =
  | "home"
  | "guide"
  | "comparison"
  | "alternatives"
  | "roundup"
  | "legal"
  | "download";

export type CtaTracking = {
  cta: "get_started" | "install_server" | "github" | "download";
  /** `list`: the list of every download on /download. */
  placement: "header" | "hero" | "final" | "open_source" | "list";
  page: CtaPageType;
};

export function trackCtaClick(
  { cta, placement, page }: CtaTracking,
  href: string,
) {
  track("cta_clicked", { cta, placement, page_type: page, href });
}
