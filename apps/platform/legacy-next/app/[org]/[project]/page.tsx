import { redirect } from "next/navigation";
export default async function ProjectIndex({
  params,
}: {
  params: Promise<{ org: string; project: string }>;
}) {
  const { org, project } = await params;
  redirect(`/app/${org}/${project}/epics`);
}
