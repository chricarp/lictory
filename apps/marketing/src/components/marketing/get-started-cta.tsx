import { ArrowRight } from "lucide-react";

import { CtaLink } from "@lictory/marketing/components/marketing/cta-link";
import { TrackedLink } from "@lictory/marketing/components/marketing/tracked-link";
import type { CtaTracking } from "@lictory/marketing/lib/cta-analytics";
import {
  getStartedLabel,
  installUrl,
  repositoryLabel,
  repositoryUrl,
} from "@lictory/marketing/lib/get-started";

// The website's calls to action: install Lictory (primary) or read its code.

export function HeaderGetStartedLinks() {
  return (
    <>
      <CtaLink
        href={repositoryUrl}
        tracking={{ cta: "github", placement: "header" }}
        variant="ghost"
        className="h-9 px-3.5"
      >
        {repositoryLabel}
      </CtaLink>
      <CtaLink
        href={installUrl}
        tracking={{ cta: "get_started", placement: "header" }}
        className="h-9 px-4 shadow-none"
      >
        {getStartedLabel}
      </CtaLink>
    </>
  );
}

/** The primary call to action: the installation guide. */
export function GetStartedCta({
  placement,
  size = "lg",
  className,
}: {
  placement: CtaTracking["placement"];
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <CtaLink
      href={installUrl}
      tracking={{ cta: "get_started", placement }}
      size={size}
      className={className}
    >
      {getStartedLabel}
      <ArrowRight aria-hidden className="size-4" />
    </CtaLink>
  );
}

/** The secondary call to action: the source repository. */
export function RepositoryCta({
  placement,
  className,
}: {
  placement: CtaTracking["placement"];
  className?: string;
}) {
  return (
    <CtaLink
      href={repositoryUrl}
      tracking={{ cta: "github", placement }}
      size="lg"
      variant="secondary"
      className={className}
    >
      {repositoryLabel}
    </CtaLink>
  );
}

/** The legal pages' header link to the installation guide. */
export function GetStartedTextLink({ className }: { className?: string }) {
  return (
    <TrackedLink
      href={installUrl}
      tracking={{ cta: "get_started", placement: "header" }}
      className={className}
    >
      {getStartedLabel}
    </TrackedLink>
  );
}
