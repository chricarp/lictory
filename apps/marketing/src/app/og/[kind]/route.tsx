import { ogCard } from "@lictory/marketing/lib/og-card";
import { previewLabels } from "@lictory/marketing/lib/social-preview";
import { siteCardTagline } from "@lictory/marketing/lib/site";

export const dynamic = "force-static";
export function generateStaticParams() {
  return ["marketing", ...Object.keys(previewLabels)].map((kind) => ({ kind }));
}
export const dynamicParams = false;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  if (kind !== "marketing" && !Object.hasOwn(previewLabels, kind))
    return new Response(null, { status: 404 });
  const marketing = kind === "marketing";
  return ogCard({
    eyebrow: marketing
      ? "The software factory"
      : "Shared work · Private details",
    title: marketing
      ? "From conversation to shipped code, with your team in charge"
      : `${previewLabels[kind as keyof typeof previewLabels]} in Lictory`,
    titleSize: marketing ? 64 : 72,
    subtitle: marketing
      ? "Channels, reviewed specifications and coding agents on your own runners, in one self-hosted product."
      : "Sign in with an account that has access to see the details.",
    footer: marketing
      ? ["Talk → Agree → Build → Ship", "Open source · Self-hosted"]
      : [siteCardTagline, "Access stays with your team."],
    headers: {
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
