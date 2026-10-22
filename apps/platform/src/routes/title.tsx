import { productName } from "@lictory/platform/lib/document-title";

// Pages outside a workspace name themselves; React hoists the element into
// <head>. Inside a workspace the shell owns the title.
export function PageTitle({ title }: { title?: string }) {
  return <title>{title ? `${title} · ${productName}` : productName}</title>;
}
