import Link from "next/link";

import { cn } from "~/lib/utils";

// Masks preserve the supplied artwork while inheriting the theme's text color.
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block size-8 shrink-0 bg-current", className)}
      style={{
        maskImage: "url(/brand/lictory-logomark.svg)",
        maskSize: "contain",
        maskPosition: "center",
        maskRepeat: "no-repeat",
      }}
    />
  );
}

export function Logo({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="Lictory home"
      className={cn(
        "inline-flex shrink-0 items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="block aspect-818/203 h-8 bg-current"
        style={{
          maskImage: "url(/brand/lictory-logo.svg)",
          maskSize: "contain",
          maskPosition: "center",
          maskRepeat: "no-repeat",
        }}
      />
    </Link>
  );
}
