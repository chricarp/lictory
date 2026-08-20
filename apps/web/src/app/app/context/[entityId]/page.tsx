import { EntityDetailPage } from "@/components/entities/entity-detail-page";

export default async function ContextPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  return <EntityDetailPage entityId={entityId} />;
}
