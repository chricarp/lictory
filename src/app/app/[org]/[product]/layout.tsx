import type { ReactNode } from "react";
import { ProductGate } from "~/components/workspace/product-gate";
export default function ProductLayout({ children }: { children: ReactNode }) {
  return <ProductGate>{children}</ProductGate>;
}
