import { ItemPage } from "@lictory/platform/components/items/item-page";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ItemPage identifier={id} />;
}
