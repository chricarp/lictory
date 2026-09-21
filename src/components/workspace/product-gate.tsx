"use client";
import { createContext, useContext, type ReactNode } from "react";
import { useParams } from "next/navigation";
import { useWorkspace } from "./provider";
import { Onboarding } from "./onboarding";
import type { Product } from "~/lib/work-items";

const ProductContext = createContext<Product | null>(null);

// Resolves the `[product]` route segment (a product key) against synchronized
// products. Unknown keys show a calm not-found state instead of a crash.
export function ProductGate({ children }: { children: ReactNode }) {
  const params = useParams<{ product: string }>();
  const { products, view, isAdmin } = useWorkspace();
  const key = params.product?.toUpperCase();
  const product = products.find((p) => p.key === key);
  if (!product) {
    if (view.status === "hydrating" || view.status === "syncing")
      return (
        <div className="p-8 text-sm text-muted-foreground" role="status">
          Opening workspace…
        </div>
      );
    if (!products.length)
      return <Onboarding step="product" canCreate={isAdmin} />;
    return (
      <div className="p-8">
        <h1 className="text-sm font-medium">Product {key} was not found</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Choose another product from the sidebar.
        </p>
      </div>
    );
  }
  return (
    <ProductContext.Provider value={product}>
      {children}
    </ProductContext.Provider>
  );
}

export function useProduct() {
  const product = useContext(ProductContext);
  if (!product) throw new Error("useProduct requires a product route.");
  return product;
}
export function useOptionalProduct() {
  return useContext(ProductContext);
}
