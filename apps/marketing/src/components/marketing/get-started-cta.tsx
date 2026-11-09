import { ArrowRight } from "lucide-react";

import { CtaLink } from "@lictory/marketing/components/marketing/cta-link";
import { TrackedLink } from "@lictory/marketing/components/marketing/tracked-link";
import type {
  CtaPageType,
  CtaTracking,
} from "@lictory/marketing/lib/cta-analytics";
import {
  getStartedLabel,
  installLabel,
  installUrl,
  repositoryLabel,
  repositoryUrl,
  tryUrl,
} from "@lictory/marketing/lib/get-started";

// The website's calls to action: try Lictory on your computer (primary),
// install it on a server (second) or read its code.

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
        href={tryUrl}
        tracking={{ cta: "get_started", placement: "header", page }}
        className="h-9 px-4 shadow-none"
      >
        {getStartedLabel}
      </CtaLink>
    </>
  );
}

/** The primary call to action: the laptop trial. */
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
      href={tryUrl}
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

/** The step after a trial: the server installation guide, as a text link. */
export function InstallServerLink({
  placement,
  page,
  className,
}: {
  placement: CtaTracking["placement"];
  page: CtaPageType;
  className?: string;
}) {
  return (
    <p className={className}>
      Ready for your team?{" "}
      <TrackedLink
        href={installUrl}
        tracking={{ cta: "install_server", placement, page }}
        className="font-medium underline underline-offset-4"
      >
        {installLabel}
      </TrackedLink>
    </p>
  );
}

/** The legal pages' header link to the laptop trial. */
export function GetStartedTextLink({ className }: { className?: string }) {
  return (
    <TrackedLink
      href={tryUrl}
      tracking={{ cta: "get_started", placement: "header", page: "legal" }}
      className={className}
    >
      {getStartedLabel}
    </TrackedLink>
  );
}
