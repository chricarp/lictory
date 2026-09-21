"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EmptyState } from "~/components/ui/primitives";
import { paths } from "~/lib/paths";
import { identifier, parseIdentifier } from "~/lib/work-items";
import { useWorkspace } from "~/components/workspace/provider";
import { useProduct } from "~/components/workspace/product-gate";
import { useShell } from "~/components/workspace/shell";
import { ItemDetail } from "./item-detail";

// Accepts a human identifier (PAY-12) or an item UUID (used right after
// creation, before the server confirms the number) and normalizes the URL.
export function ItemPage({ identifier: raw }: { identifier: string }) {
  const { items, view, organization } = useWorkspace();
  const product = useProduct();
  const { setCurrentItem } = useShell();
  const router = useRouter();
  const parsed = parseIdentifier(raw);
  const item = items.find((i) =>
    parsed
      ? i.productId === product.id &&
        parsed.key === product.key &&
        i.number === parsed.number
      : i.id === raw,
  );
  const pendingCreate = item
    ? view.pending.some(
        (q) =>
          q.mutation.command.type === "createWorkItem" &&
          q.mutation.command.workItemId === item.id,
      )
    : false;
  useEffect(() => {
    setCurrentItem(item);
    return () => setCurrentItem(undefined);
  }, [item, setCurrentItem]);
  useEffect(() => {
    if (item && !parsed && !pendingCreate)
      router.replace(
        paths.item(
          organization.slug,
          product.key,
          item.kind === "epic" ? "epics" : "stories",
          identifier(product, item.number),
        ),
      );
  }, [item, parsed, pendingCreate, router, organization.slug, product]);
  if (!item) {
    if (view.status === "hydrating" || view.status === "syncing")
      return (
        <div className="p-8 text-sm text-muted-foreground" role="status">
          Opening {raw}…
        </div>
      );
    return (
      <EmptyState
        title={`${raw} was not found in ${product.name}`}
        action={
          <Link
            href={paths.list(organization.slug, product.key, "epics")}
            className="text-sm text-primary hover:underline"
          >
            Back to Epics
          </Link>
        }
      >
        It may belong to another product, or the identifier is misspelled.
      </EmptyState>
    );
  }
  return (
    <ItemDetail
      key={item.id}
      item={item}
      product={product}
      pendingCreate={pendingCreate}
    />
  );
}
