// The Lictory application lives on its own origin. The website never reads its
// session or data, so calls to action link there and the application decides
// what a visitor sees; only a non-identifying signed-in hint (see
// `lib/signed-in.ts`) picks the label. Kept free of other imports: client
// components use it.

/** An origin from configuration; an empty variable counts as unset. */
export function configuredOrigin(value: string | undefined, fallback: string) {
  return new URL(value === undefined || value === "" ? fallback : value).origin;
}

/** Embedded at build time, like every `NEXT_PUBLIC_` variable. */
export const platformUrl = configuredOrigin(
  process.env.NEXT_PUBLIC_PLATFORM_URL,
  process.env.NODE_ENV === "production"
    ? "https://app.lictory.com"
    : "http://localhost:3000",
);

export function platformHref(path: "/" | "/sign-in" | "/sign-up") {
  return new URL(path, platformUrl).toString();
}
