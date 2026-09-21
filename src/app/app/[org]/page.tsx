"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "~/components/workspace/provider";
import { Onboarding } from "~/components/workspace/onboarding";
import { paths } from "~/lib/paths";

// Organization root: open the first product's Epics, or create the first product.
export default function OrganizationIndex() {
  const { organization, products, view, isAdmin } = useWorkspace();
  const router = useRouter();
  const first = products[0];
  useEffect(() => {
    if (first)
      router.replace(paths.list(organization.slug, first.key, "epics"));
  }, [first, organization.slug, router]);
  if (first || view.status === "hydrating") return null;
  return <Onboarding step="product" canCreate={isAdmin} />;
}
