import { notFound } from "next/navigation";

import { markdownDocument, markdownPages } from "~/lib/markdown";
import { absoluteUrl } from "~/lib/site";

// Served at `<page>.md` through rewrites in next.config.ts. The HTML page is
// declared canonical so search engines index it rather than this copy.

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return markdownPages.map((path) => ({
    path: path.split("/").filter(Boolean),
  }));
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/markdown/[...path]">,
) {
  const { path: segments } = await params;
  const path = `/${segments.join("/")}`;
  const document = markdownDocument(path);
  if (!document) notFound();
  return new Response(document, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${absoluteUrl(path)}>; rel="canonical"`,
    },
  });
}
