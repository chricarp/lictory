import { Invitation } from "~/components/app/invitation";
export default async function InvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  return <Invitation id={id} />;
}
