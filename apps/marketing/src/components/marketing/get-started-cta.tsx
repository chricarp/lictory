import { ArrowRight } from "lucide-react";

import { CtaLink } from "@lictory/marketing/components/marketing/cta-link";
import { TrackedLink } from "@lictory/marketing/components/marketing/tracked-link";
import type {
  CtaPageType,
  CtaTracking,
} from "@lictory/marketing/lib/cta-analytics";
import {
  getStartedLabel,
  installUrl,
  repositoryLabel,
  repositoryUrl,
} from "@lictory/marketing/lib/get-started";

// The website's calls to action: install Lictory (primary) or read its code.

export function HeaderGetStartedLinks({ page }: { page: CtaPageType }) {
  return (
    <>
      <CtaLink
        href={repositoryUrl}
        tracking={{ cta: "github", placement: "header", page }}
        variant="ghost"
        className="h-9 px-3.5"
      >
        {repositoryLabel}
      </CtaLink>
      <CtaLink
        href={installUrl}
        tracking={{ cta: "get_started", placement: "header", page }}
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
  page,
  size = "lg",
  className,
}: {
  placement: CtaTracking["placement"];
  page: CtaPageType;
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <CtaLink
      href={installUrl}
      tracking={{ cta: "get_started", placement, page }}
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
  page,
  className,
}: {
  placement: CtaTracking["placement"];
  page: CtaPageType;
  className?: string;
}) {
  return (
    <CtaLink
      href={repositoryUrl}
      tracking={{ cta: "github", placement, page }}
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
      tracking={{ cta: "get_started", placement: "header", page: "legal" }}
      className={className}
    >
      {getStartedLabel}
    </TrackedLink>
  );
}
