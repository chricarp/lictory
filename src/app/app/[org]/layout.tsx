import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "~/lib/auth";
import { db } from "~/db";
import { directory } from "~/sync/server/service";
import { directorySchema } from "~/sync/shared/protocol";
import { WorkspaceProvider } from "~/components/workspace/provider";
import { Shell } from "~/components/workspace/shell";

export default async function OrganizationLayout({
  children,
  params,
}: LayoutProps<"/app/[org]">) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { org } = await params;
  const initial = await directory(db, session.user.id);
  const organization = initial.organizations.find((o) => o.slug === org);
  if (!organization) notFound();
  const roster = directorySchema.parse(
    await directory(db, session.user.id, organization.id),
  );
  return (
    <WorkspaceProvider
      key={organization.id}
      userId={session.user.id}
      organization={organization}
      initialDirectory={roster}
    >
      <Shell user={{ name: session.user.name, email: session.user.email }}>
        {children}
      </Shell>
    </WorkspaceProvider>
  );
}
