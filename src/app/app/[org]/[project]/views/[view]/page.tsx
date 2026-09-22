import { views } from "~/lib/work-items";
import { ViewPage } from "~/components/items/view-page";
import { UnknownView } from "~/components/workspace/unknown-view";

export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  const known = views.find((v) => v.id === view);
  if (!known) return <UnknownView />;
  return <ViewPage view={known.id} />;
}
