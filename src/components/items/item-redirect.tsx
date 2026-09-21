"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { EmptyState } from "~/components/ui/primitives";
import { paths } from "~/lib/paths";
import { identifier, parseIdentifier } from "~/lib/work-items";
import { useWorkspace } from "~/components/workspace/provider";

export function ItemRedirect({ identifier: raw }: { identifier: string }) {
  const { items, products, organization, view } = useWorkspace();
  const router = useRouter();
  const parsed = parseIdentifier(raw);
  const product = parsed
    ? products.find((p) => p.key === parsed.key)
    : undefined;
  const item = parsed
    ? items.find(
        (i) => i.productId === product?.id && i.number === parsed.number,
      )
    : items.find((i) => i.id === raw);
  const target = item
    ? paths.item(
        organization.slug,
        products.find((p) => p.id === item.productId)?.key ?? "",
        item.kind === "epic" ? "epics" : "stories",
        identifier(
          products.find((p) => p.id === item.productId),
          item.number,
        ),
      )
    : undefined;
  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);
  if (target || view.status === "hydrating" || view.status === "syncing")
    return (
      <div className="p-8 text-sm text-muted-foreground" role="status">
        Opening {raw}…
      </div>
    );
  return (
    <EmptyState
      title={`${raw} was not found`}
      action={
        <Link
          href={paths.inbox(organization.slug)}
          className="text-sm text-primary hover:underline"
        >
          Go to Inbox
        </Link>
      }
    >
      {parsed && !product
        ? `No product uses the key ${parsed.key}.`
        : "Check the identifier and try again."}
    </EmptyState>
  );
}
