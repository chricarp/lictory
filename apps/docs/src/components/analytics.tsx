"use client";

import {
  CodeBlock,
  type CodeBlockProps,
} from "fumadocs-ui/components/codeblock";
import { useEffect } from "react";

import { track } from "@lictory/core/lib/analytics/client";
import { site } from "@lictory/docs/lib/site";

// Documentation funnel events. Each one sends only controlled values: never
// the search query and never the copied text. `track` does nothing unless the
// build carries PostHog settings and PostHog has loaded (ConsentProvider).

/**
 * Fumadocs' code block with a copy event. The `Actions` slot wraps the copy
 * button, so the event fires on its click without forking the component.
 */
export function TrackedCodeBlock({
  surface,
  command,
  ...props
}: CodeBlockProps & { surface: "cli" | "mdx"; command?: string }) {
  return (
    <CodeBlock
      {...props}
      Actions={({ className, children }) => (
        <div
          className={`empty:hidden ${className ?? ""}`}
          onClickCapture={(event) => {
            if ((event.target as Element).closest("button"))
              track(
                "code_copied",
                command ? { surface, command } : { surface },
              );
          }}
        >
          {children}
        </div>
      )}
    />
  );
}

const navCtas: Record<string, "github" | "website"> = {
  [site.repository]: "github",
  [site.website]: "website",
};

/**
 * Clicks on the layout's GitHub and Website links (`baseOptions`). Fumadocs
 * renders them without a click hook, so one listener matches their exact
 * addresses outside the page body, where content may link to the same URLs.
 */
export function NavCtaTracking() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!link || link.closest("#nd-page")) return;
      const href = link.getAttribute("href") ?? "";
      const cta = navCtas[href];
      if (cta) track("cta_clicked", { cta, placement: "nav", href });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
