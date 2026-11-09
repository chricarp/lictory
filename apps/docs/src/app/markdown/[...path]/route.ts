import { pageMarkdown } from "@lictory/docs/lib/markdown";
import { markdownPath } from "@lictory/docs/lib/site";
import { source } from "@lictory/docs/lib/source";

// Exported as /markdown/<page>.md; the Worker serves it at /<page>.md
// (deploy/cloudflare/src/worker.ts), and robots.txt keeps /markdown/ private.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    path: markdownPath(page.url).slice(1).split("/"),
  }));
}

export async function GET(
  _request: Request,
  { params }: RouteContext<"/markdown/[...path]">,
) {
  const { path } = await params;
  const requested = `/${path.join("/")}`;
  const page = source
    .getPages()
    .find((candidate) => markdownPath(candidate.url) === requested);
  if (!page) return new Response(null, { status: 404 });
  return new Response(await pageMarkdown(page), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
