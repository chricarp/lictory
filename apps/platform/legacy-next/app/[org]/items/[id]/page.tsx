import { ItemRedirect } from "@lictory/platform/components/items/item-redirect";
// Project-agnostic deep link: /app/[org]/items/PAY-142 resolves the project from
// the identifier's key and forwards to the canonical route.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ItemRedirect identifier={id} />;
}
