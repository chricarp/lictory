import type { Metadata } from "next";
import { Invitation } from "~/components/app/invitation";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <Invitation id={id} />;
}
