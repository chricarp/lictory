"use client";
import { useSelectedLayoutSegment } from "next/navigation";
import { useCallback, useMemo, type ReactNode } from "react";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import { identifier } from "~/lib/work-items";
import type { WorkItem } from "~/sync/shared/protocol";
import { useWorkspace } from "~/components/workspace/provider";
import { useProduct } from "~/components/workspace/product-gate";
import { IssueList } from "./issue-list";

// List + detail side by side on wide screens. Both read from the organization
// store, so selecting another item only changes which local data is shown. The
// URL stays the source of truth; on narrow screens the detail takes over.
export function SplitView({
  kind,
  children,
}: {
  kind: "epics" | "stories";
  children: ReactNode;
}) {
  const segment = useSelectedLayoutSegment();
  const { items, organization } = useWorkspace();
  const product = useProduct();
  const selected =
    segment && segment !== "__DEFAULT__"
      ? decodeURIComponent(segment)
      : undefined;
  const scoped = useMemo(
    () =>
      items.filter(
        (i) =>
          i.productId === product.id &&
          (kind === "epics" ? i.kind === "epic" : i.kind !== "epic"),
      ),
    [items, product.id, kind],
  );
  const selectedItem = selected
    ? scoped.find(
        (i) =>
          i.id === selected ||
          identifier(product, i.number).toLowerCase() ===
            selected.toLowerCase(),
      )
    : undefined;
  const hrefFor = useCallback(
    (item: WorkItem) =>
      paths.item(
        organization.slug,
        product.key,
        kind,
        identifier(product, item.number),
      ),
    [organization.slug, product, kind],
  );
  const list = (compact: boolean) => (
    <IssueList
      items={scoped}
      product={product}
      hrefFor={hrefFor}
      selectedId={selectedItem?.id}
      compact={compact}
      title={kind === "epics" ? "Epics" : "Stories"}
      createKind={kind === "epics" ? "epic" : "story"}
      allowEpicFilter={kind === "stories"}
      emptyTitle={kind === "epics" ? "No epics yet" : "No stories yet"}
      emptyBody={
        kind === "epics"
          ? "An Epic captures a product capability. Start with a title; refine it with your team."
          : "Stories describe concrete behavior engineering will implement. Create them from an Epic or here."
      }
    />
  );
  if (!selected) return <div className="h-full">{list(false)}</div>;
  return (
    <div className="flex h-full">
      <div className={cn("hidden w-[320px] shrink-0 border-r xl:block")}>
        {list(true)}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
