import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CtaLink } from "@lictory/marketing/components/marketing/cta-link";
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
      <CtaLink href={repositoryUrl} variant="ghost" className="h-9 px-3.5">
        {repositoryLabel}
      </CtaLink>
      <CtaLink href={installUrl} className="h-9 px-4 shadow-none">
        {getStartedLabel}
      </CtaLink>
    </>
  );
}

/** The primary call to action: the installation guide. */
export function GetStartedCta({
  size = "lg",
  className,
}: {
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <CtaLink href={installUrl} size={size} className={className}>
      {getStartedLabel}
      <ArrowRight aria-hidden className="size-4" />
    </CtaLink>
  );
}

/** The secondary call to action: the source repository. */
export function RepositoryCta({ className }: { className?: string }) {
  return (
    <CtaLink
      href={repositoryUrl}
      size="lg"
      variant="secondary"
      className={className}
    >
      {repositoryLabel}
    </CtaLink>
  );
}

export function GetStartedTextLink({ className }: { className?: string }) {
  return (
    <Link href={installUrl} className={className}>
      {getStartedLabel}
    </Link>
  );
}
