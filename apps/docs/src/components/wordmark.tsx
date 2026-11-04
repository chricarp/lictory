// The supplied Lictory artwork as a mask, so it takes the text color in light
// and dark themes (docs/internals/design.md).
export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="block aspect-818/203 h-5 bg-current"
        style={{
          maskImage: "url(/brand/lictory-logo.svg)",
          maskSize: "contain",
          maskPosition: "center",
          maskRepeat: "no-repeat",
        }}
      />
      <span className="sr-only">Lictory</span>
      <span className="text-fd-muted-foreground font-medium">Docs</span>
    </span>
  );
}
