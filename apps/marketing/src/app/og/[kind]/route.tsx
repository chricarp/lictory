import { ogCard, sharedWorkCard } from "@lictory/marketing/lib/og-card";
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
  const card =
    kind === "marketing"
      ? {
          eyebrow: "Before the first line of code",
          title: "Agree on what to build before anyone builds it",
          titleSize: 68,
          subtitle:
            "People and agents refine one specification on parallel branches.",
          footer: [
            "Branch → Review → Merge → Deliver",
            "Open-source work management",
          ] as [string, string],
        }
      : sharedWorkCard(previewLabels[kind as keyof typeof previewLabels]);
  return ogCard({
    ...card,
    headers: {
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
