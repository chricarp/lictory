import { eq } from "drizzle-orm";
import { project } from "@lictory/core/db/domain-schema";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requestSession } from "../../session";
import { db } from "@lictory/core/db";
import { directory } from "@lictory/core/domain/service";
import { directorySchema } from "@lictory/core/contracts/protocol";
import { WorkspaceProvider } from "@lictory/platform/components/workspace/provider";
import { OnboardingSetup } from "@lictory/platform/components/workspace/onboarding-setup";
import { applicationRoleOf } from "@lictory/core/contracts/protocol";
import { Shell } from "@lictory/platform/components/workspace/shell";

// Inside a workspace the Shell renders the document title from live client
// state (route, project, open item). Emitting a route title here as well would
// leave two <title> elements and swap the node on every navigation.
export const metadata: Metadata = { title: null };

export default async function OrganizationLayout({
  children,
  params,
}: LayoutProps<"/app/[org]">) {
  const session = await requestSession();
  if (!session) redirect("/sign-in");
  const { org } = await params;
  const initial = await directory(db, session.user.id);
  const organization = initial.organizations.find((o) => o.slug === org);
  if (!organization) notFound();
  const roster = directorySchema.parse(
    await directory(db, session.user.id, organization.id),
  );
  // Archived projects still prove that the organization was configured.
  const needsSetup =
    !roster.projects.length &&
    !(
      await db
        .select({ id: project.id })
        .from(project)
        .where(eq(project.organizationId, organization.id))
        .limit(1)
    ).length;
  return (
    <WorkspaceProvider
      key={organization.id}
      userId={session.user.id}
      organization={organization}
      initialDirectory={roster}
    >
      {needsSetup ? (
        <OnboardingSetup
          canCreate={applicationRoleOf(organization.role) === "admin"}
        />
      ) : (
        <Shell
          user={{
            name: session.user.name,
            image: session.user.image,
            email: session.user.email,
            handle: session.user.handle ?? null,
          }}
        >
          {children}
        </Shell>
      )}
    </WorkspaceProvider>
  );
}
