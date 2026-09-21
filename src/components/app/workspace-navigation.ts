import type { Scope } from "~/sync/shared/protocol";
export const value = (data: FormData, name: string) => {
  const field = data.get(name);
  return typeof field === "string" ? field : "";
};
export function href(scope: Scope, tab = "proposals", proposal?: string) {
  return `/app?${new URLSearchParams({ org: scope.organizationId, ...(scope.productId ? { product: scope.productId } : {}), tab, ...(proposal ? { proposal } : {}) })}`;
}
