import { ItemRedirect } from "~/components/items/item-redirect";
// Product-agnostic deep link: /app/[org]/items/PAY-142 resolves the product from
// the identifier's key and forwards to the canonical route.
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ItemRedirect identifier={id} />;
}
