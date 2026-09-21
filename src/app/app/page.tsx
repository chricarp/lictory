import { headers } from "next/headers";
import { auth } from "~/lib/auth";
import { db } from "~/db";
import { directory } from "~/sync/server/service";
import { directorySchema } from "~/sync/shared/protocol";
import { Workspace } from "~/components/app/workspace";
export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const params = await searchParams;
  const initial = await directory(db, session.user.id);
  const organizationId =
    initial.organizations.find((o) => o.id === params.org)?.id ??
    initial.organizations[0]?.id;
  const roster = directorySchema.parse(
    await directory(db, session.user.id, organizationId),
  );
  const productId =
    roster.products.find((p) => p.id === params.product)?.id ??
    roster.products[0]?.id;
  const proposalId =
    typeof params.proposal === "string" ? params.proposal : undefined;
  const tab = typeof params.tab === "string" ? params.tab : "proposals";
  return (
    <Workspace
      key={`${organizationId}:${productId}:${proposalId}:${tab}`}
      userId={session.user.id}
      initialDirectory={roster}
      scope={
        organizationId ? { organizationId, productId, proposalId } : undefined
      }
      tab={tab}
    />
  );
}
