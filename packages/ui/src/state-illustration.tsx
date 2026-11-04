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
  // The artwork rests in a hatched tray, in grayscale, so it belongs to the
  // product's neutral instrument-panel language rather than standing apart.
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mx-auto mb-5 grid size-40 shrink-0 place-items-center rounded-[1.75rem] bg-tray [background-image:var(--hatch)] ring-1 ring-border/70 ring-inset",
        className,
      )}
    >
      <img
        src={illustrationAssets[kind]}
        alt=""
        width={384}
        height={384}
        loading="lazy"
        decoding="async"
        draggable={false}
        className="size-[80%] object-contain opacity-90 contrast-[1.05] grayscale"
      />
    </span>
  );
}
