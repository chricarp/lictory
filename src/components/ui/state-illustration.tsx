import Image from "next/image";

import { cn } from "~/lib/utils";
import { illustrationAssets } from "./illustration-assets";

export type IllustrationKind = keyof typeof illustrationAssets;

/** Decorative artwork; the adjacent heading and recovery action carry meaning. */
export function StateIllustration({
  kind,
  className,
}: {
  kind: IllustrationKind;
  className?: string;
}) {
  return (
    <Image
      src={illustrationAssets[kind]}
      alt=""
      aria-hidden="true"
      width={384}
      height={384}
      unoptimized
      loading="lazy"
      draggable={false}
      className={cn("mx-auto mb-4 size-40 shrink-0 object-contain", className)}
    />
  );
}
