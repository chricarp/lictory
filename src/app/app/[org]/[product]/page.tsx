import { redirect } from "next/navigation";
export default async function ProductIndex({
  params,
}: {
  params: Promise<{ org: string; product: string }>;
}) {
  const { org, product } = await params;
  redirect(`/app/${org}/${product}/epics`);
}
