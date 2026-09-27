import { redirect } from "next/navigation";
export default async function TeamPage({
  params,
}: PageProps<"/app/[org]/teams/[team]">) {
  const { org, team } = await params;
  redirect(`/app/${org}/teams/${team}/board`);
}
