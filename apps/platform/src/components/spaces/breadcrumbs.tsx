import type { ReactNode } from "react";
import { ChevronRight, FileText } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { Popover, usePopover } from "@lictory/ui/popover";
import { Link } from "@lictory/platform/lib/navigation";
import type { Space, SpacePage } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Menu, MenuItem } from "@lictory/platform/components/spaces/menu";

// Spaces › space › ancestors › page. Every page of a space shares its
// access, so ancestors never reveal anything the reader cannot open. A page
// view leaves its own title out (its heading follows right below) so the
// path keeps room beside the toolbar. The immediate parent matters most:
// ancestors between the space and the parent fold into "…", and the space's
// name gives way before the parent's does.
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
    ...(ancestors.length > 1
      ? [
          {
            key: "folded",
            className: "shrink-0",
            node: (
              <FoldedAncestors
                ancestors={ancestors.slice(0, -1)}
                href={(id) => paths.spacePage(org, space.slug, id)}
              />
            ),
          },
        ]
      : []),
    ...ancestors.slice(-1).map((ancestor) => ({
      key: ancestor.id,
      className: "max-w-48 shrink-0",
      node: (
        <Link
          href={paths.spacePage(org, space.slug, ancestor.id)}
          className={link}
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

// The ancestors between the space and the parent, one step away.
function FoldedAncestors({
  ancestors,
  href,
}: {
  ancestors: SpacePage[];
  href: (pageId: string) => string;
}) {
  return (
    <Popover
      width={240}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          aria-label={`${ancestors.length} more ${ancestors.length === 1 ? "page" : "pages"} in the path`}
          title={ancestors.map((a) => a.title).join(" › ")}
          className="grid h-6 min-w-6 place-items-center rounded-sm px-1 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          …
        </button>
      )}
    >
      {(close) => (
        <FoldedMenu ancestors={ancestors} href={href} close={close} />
      )}
    </Popover>
  );
}

function FoldedMenu({
  ancestors,
  href,
  close,
}: {
  ancestors: SpacePage[];
  href: (pageId: string) => string;
  close: () => void;
}) {
  const labelId = usePopover()?.labelId;
  return (
    <>
      <h2 id={labelId} className="sr-only">
        Pages in the path
      </h2>
      <Menu label="Pages in the path">
        {ancestors.map((ancestor) => (
          <MenuItem
            key={ancestor.id}
            icon={<FileText />}
            href={href(ancestor.id)}
            onSelect={close}
          >
            {ancestor.title}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
