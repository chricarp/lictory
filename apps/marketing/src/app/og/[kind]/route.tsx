import { ogCard } from "@lictory/marketing/lib/og-card";
import { previewLabels } from "@lictory/marketing/lib/social-preview";

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
      ? "Before the first line of code"
      : "Shared work · Private details",
    title: marketing
      ? "Agree on what to build before anyone builds it"
      : `${previewLabels[kind as keyof typeof previewLabels]} in Lictory`,
    titleSize: marketing ? 68 : 72,
    subtitle: marketing
      ? "People and agents refine one specification on parallel branches."
      : "Sign in with an account that has access to see the details.",
    footer: marketing
      ? ["Branch → Review → Merge → Deliver", "Open-source work management"]
      : ["Requirements, reviewed like code.", "Access stays with your team."],
    headers: {
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
