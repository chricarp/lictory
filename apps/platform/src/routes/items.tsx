import { ItemRedirect } from "@lictory/platform/components/items/item-redirect";
import { ViewPage } from "@lictory/platform/components/items/view-page";
import { useEffect } from "react";
import {
  useParams,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { paths } from "@lictory/core/lib/paths";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useProject } from "@lictory/platform/components/workspace/project-gate";
import { ItemPage } from "@lictory/platform/components/items/item-page";
import { UnknownView } from "@lictory/platform/components/workspace/unknown-view";
import { views } from "@lictory/core/lib/work-items";

// Project-agnostic deep link: /{org}/items/PAY-142 resolves the project from
// the identifier's key and forwards to the canonical route.
export function ItemRedirectRoute() {
  const { id } = useParams<{ id: string }>();
  return <ItemRedirect key={id} identifier={id ?? ""} />;
}

export function ReviewsRoute() {
  return <ViewPage view="needs-my-review" />;
}

export function ItemRoute() {
  const { id } = useParams<{ id: string }>();
  return <ItemPage key={id} identifier={id ?? ""} />;
}

export function SavedViewRoute() {
  const { view } = useParams<{ view: string }>();
  const known = views.find((v) => v.id === view);
  if (!known) return <UnknownView />;
  return <ViewPage view={known.id} />;
}

export function ProposalsRoute() {
  return <ViewPage view="all" phase="proposal" />;
}
export function RefinementRoute() {
  return <ViewPage view="all" phase="refinement" />;
}
export { AllItemsPage as AllItemsRoute } from "@lictory/platform/components/items/all-items-page";

// /epics and /stories predate type-neutral addresses.
export function LegacyItemsRoute() {
  const { id } = useParams<{ id?: string }>();
  const { organization } = useWorkspace();
  const project = useProject();
  const searchParams = useSearchParams();
  const router = useRouter();
  const target = id
    ? paths.item(organization.slug, project.key, id, searchParams)
    : paths.items(organization.slug, project.key, searchParams);
  useEffect(() => {
    router.replace(target);
  }, [router, target]);
  return null;
}
