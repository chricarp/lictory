"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

import {
  trackCtaClick,
  type CtaTracking,
} from "@lictory/marketing/lib/cta-analytics";

/** A link that reports `cta_clicked` without delaying navigation. */
export function TrackedLink({
  tracking,
  href,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  tracking: CtaTracking;
}) {
  return (
    <Link
      {...props}
      href={href}
      onClick={(event) => {
        trackCtaClick(tracking, href);
        onClick?.(event);
      }}
    />
  );
}
