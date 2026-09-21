import { notFound } from "next/navigation";
import { ViewPage } from "~/components/items/view-page";
import { views } from "~/lib/work-items";
export default async function Page({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  const known = views.find((v) => v.id === view);
  if (!known) notFound();
  return <ViewPage view={known.id} />;
}
