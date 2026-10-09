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

// The Lictory mark with a spark: the brand of Lictory Intelligence. Inline so
// it sizes and colors like the surrounding icons.
export function IntelligenceMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 188 201"
      fill="currentColor"
      className={cn("size-4 shrink-0", className)}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36 171.8 34 171.5 32 170.43 4 154.6 1.69 153-.28 150-.56 147-.36 41 1.45 38 4 35.95 60 3.67 66 .48 68-.21 70-.13 72 .52 73.61 2 74.74 4 74.89 5 74.91 48 74.46 51 73.41 53 71 55.17 41.38 72 38.68 75 36.89 80 36.81 170 36.72 171 36 171.8ZM59 140.28 57 140.83 55 140.5 53.53 139 52.64 137 52.61 88 53.71 84 57 80.7 83 66.35 114 48.53 117 47.53 120 48.18 121.12 49 122.5 51 123.03 55 122.94 99 122.35 102 121.11 104 118 106.48 59 140.28ZM92 200.27 88 200.31 85 199.38 65 188.22 55 182 53.58 180 52.59 176 52.67 165 54 162.01 55 160.77 58 158.63 118 124.63 136 114.6 139 113.54 144 113.61 147 114.65 184 135.56 186.38 138 187.38 141 187.35 143 186.36 146 184 148.54 109 191.31 95 199.15 92 200.27Z"
      />
      <path d="M158 4c2.5 22 8 30.5 30 33-22 2.5-27.5 11-30 33-2.5-22-8-30.5-30-33 22-2.5 27.5-11 30-33Z" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
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
