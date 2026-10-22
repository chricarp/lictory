import { cn } from "@lictory/core/lib/utils";
import { illustrationAssets } from "@lictory/ui/illustration-assets";

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
    <img
      src={illustrationAssets[kind]}
      alt=""
      aria-hidden="true"
      width={384}
      height={384}
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn("mx-auto mb-4 size-40 shrink-0 object-contain", className)}
    />
  );
}
