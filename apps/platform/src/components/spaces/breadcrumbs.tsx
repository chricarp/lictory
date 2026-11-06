import { ChevronRight } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { Link } from "@lictory/platform/lib/navigation";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// Spaces › space › ancestors › page. Every page of a space shares its
// access, so ancestors never reveal anything the reader cannot open.
export function SpaceBreadcrumbs({
  space,
  ancestors = [],
  page,
}: {
  space: Space;
  ancestors?: SpacePage[];
  page?: SpacePage;
}) {
  const { organization } = useWorkspace();
  const org = organization.slug;
  const link =
    "truncate rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60";
  const separator = (
    <ChevronRight className="size-3 shrink-0 opacity-60" aria-hidden />
  );
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1">
          <Link href={paths.spaces(org)} className={link}>
            Spaces
          </Link>
          {separator}
        </li>
        <li className="flex min-w-0 items-center gap-1">
          {page ? (
            <>
              <Link href={paths.space(org, space.slug)} className={link}>
                {space.name}
              </Link>
              {separator}
            </>
          ) : (
            <span aria-current="page" className="truncate text-foreground">
              {space.name}
            </span>
          )}
        </li>
        {ancestors.map((ancestor) => (
          <li key={ancestor.id} className="flex min-w-0 items-center gap-1">
            <Link
              href={paths.spacePage(org, space.slug, ancestor.id)}
              className={`${link} max-w-48`}
            >
              {ancestor.title}
            </Link>
            {separator}
          </li>
        ))}
        {page && (
          <li className="min-w-0">
            <span
              aria-current="page"
              className="block max-w-64 truncate text-foreground"
            >
              {page.title}
            </span>
          </li>
        )}
      </ol>
    </nav>
  );
}
