import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { Link } from "@lictory/platform/lib/navigation";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Spaces › space › ancestors › page. Every page of a space shares its
// access, so ancestors never reveal anything the reader cannot open. A page
// view leaves its own title out (its heading follows right below) so the
// path keeps room beside the toolbar.
export function SpaceBreadcrumbs({
  space,
  ancestors = [],
  page,
  showPage = true,
}: {
  space: Space;
  ancestors?: SpacePage[];
  page?: SpacePage;
  showPage?: boolean;
}) {
  const { organization } = useWorkspace();
  const org = organization.slug;
  const link =
    "block min-w-0 truncate rounded-sm py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60";
  const items: { key: string; node: ReactNode; className?: string }[] = [
    {
      key: "spaces",
      className: "shrink-0",
      node: (
        <Link href={paths.spaces(org)} className={link}>
          Spaces
        </Link>
      ),
    },
    {
      key: "space",
      node: page ? (
        <Link href={paths.space(org, space.slug)} className={link}>
          {space.name}
        </Link>
      ) : (
        <span aria-current="page" className="block truncate text-foreground">
          {space.name}
        </span>
      ),
    },
    ...ancestors.map((ancestor) => ({
      key: ancestor.id,
      node: (
        <Link
          href={paths.spacePage(org, space.slug, ancestor.id)}
          className={`${link} max-w-40`}
        >
          {ancestor.title}
        </Link>
      ),
    })),
    ...(page && showPage
      ? [
          {
            key: page.id,
            node: (
              <span
                aria-current="page"
                className="block truncate text-foreground"
              >
                {page.title}
              </span>
            ),
          },
        ]
      : []),
  ];
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {items.map((item, index) => (
          <li
            key={item.key}
            className={cn("flex min-w-0 items-center gap-1", item.className)}
          >
            {item.node}
            {index < items.length - 1 && (
              <ChevronRight
                className="size-3 shrink-0 opacity-60"
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
