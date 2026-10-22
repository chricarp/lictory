import { redirect } from "next/navigation";
import { paths } from "@lictory/core/lib/paths";
// Notifications live in the Inbox ("Updates").
export default async function Page({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  redirect(paths.inbox((await params).org));
}
