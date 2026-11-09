import { llmsIndex } from "@lictory/docs/lib/llms";

export const dynamic = "force-static";

export async function GET() {
  return new Response(await llmsIndex(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
