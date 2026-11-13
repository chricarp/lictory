import type { ReactNode } from "react";
import { labelNamesTarget, parseAppLink } from "@lictory/core/lib/app-links";
import { useOptionalWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  ReferenceChip,
  ReferenceTextLink,
} from "@lictory/platform/components/references/chips";
import { useReferences } from "@lictory/platform/components/references/data";

// A link in text written outside the editors (Litto's answers) that points
// at one of this organization's work items or pages: shown as the same live
// reference the documents use. The link becomes a chip when its words name
// the target (the key, the title, the address) and the address is the
// target itself; other words ("blocking discussion") stay, with the
// target's card. Anything I cannot read, and every other link, renders as
// `fallback`.

export function AppLink({
  href,
  label,
  className,
  children,
  fallback,
}: {
  href: string;
  // The link's text as written.
  label: string;
  // The style of an ordinary link, kept for words that stay words.
  className?: string;
  children: ReactNode;
  fallback: ReactNode;
}) {
  const slug = useOptionalWorkspace()?.organization.slug;
  const references = useReferences();
  const link = slug
    ? parseAppLink(
        href,
        slug,
        typeof window === "undefined" ? undefined : window.location.origin,
      )
    : undefined;
  if (!link) return fallback;
  if (link.kind === "item") {
    const item = references.itemByKey(link.key);
    if (!item) return fallback;
    const target = { kind: "item", id: item.id } as const;
    return link.whole && labelNamesTarget(label, item, href) ? (
      <ReferenceChip target={target} label={label} />
    ) : (
      <ReferenceTextLink target={target} href={href} className={className}>
        {children}
      </ReferenceTextLink>
    );
  }
  const page = references.page(link.id);
  if (!page) return fallback;
  const target = {
    kind: "page",
    id: page.id,
    ...(link.commitId ? { commitId: link.commitId } : {}),
  } as const;
  return link.whole && labelNamesTarget(label, page, href) ? (
    <ReferenceChip target={target} label={label} />
  ) : (
    <ReferenceTextLink target={target} href={href} className={className}>
      {children}
    </ReferenceTextLink>
  );
}
