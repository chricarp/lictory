import { ogCard } from "~/lib/og-card";
import { previewLabels } from "~/lib/social-preview";

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
      ? "LESS AMBIGUITY. MORE MOMENTUM."
      : "SHARED WORK · PRIVATE DETAILS",
    title: marketing
      ? "Requirements, reviewed like code."
      : `${previewLabels[kind as keyof typeof previewLabels]} in Lictory`,
    titleSize: marketing ? 76 : 72,
    subtitle: marketing
      ? "Turn product intent into work your team can commit to."
      : "Sign in with an account that has access to see the details.",
    footer: marketing
      ? ["Draft → Review → Refine → Deliver", "Built for agreement."]
      : ["Requirements, reviewed like code.", "Access stays with your team."],
    headers: {
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
