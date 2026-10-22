import { ItemRedirect } from "@lictory/platform/components/items/item-redirect";
import { ViewPage } from "@lictory/platform/components/items/view-page";
import { useParams } from "@lictory/platform/lib/navigation";
import { ItemPage } from "@lictory/platform/components/items/item-page";
import { UnknownView } from "@lictory/platform/components/workspace/unknown-view";
import { views, type ViewId } from "@lictory/core/lib/work-items";

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
  return <ViewPage view={known.id as ViewId} />;
}
