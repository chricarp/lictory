"use client";

import { Fragment, useId, useMemo, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import Link from "fumadocs-core/link";
import { getBreadcrumbItemsFromPath } from "fumadocs-core/breadcrumb";
import { usePathname } from "fumadocs-core/framework";
import type * as PageTree from "fumadocs-core/page-tree";
import {
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderLink,
  SidebarFolderTrigger,
  SidebarItem,
  useFolderDepth,
} from "fumadocs-ui/components/sidebar/base";
import { useTreeContext, useTreePath } from "fumadocs-ui/contexts/tree";
import type { BreadcrumbProps } from "fumadocs-ui/layouts/docs/page";
import {
  GROUP_FOLDER,
  NAV_FOLDER,
  isLayoutFolder,
} from "@lictory/docs/lib/sidebar-tree";

// The sidebar's page tree as navigation: one <nav>, each group a heading
// over a list of links (lib/sidebar-tree.ts groups the tree). Rows keep
// Fumadocs' own look.

const row =
  "relative flex flex-row items-center gap-2 rounded-lg p-2 text-start text-fd-muted-foreground wrap-anywhere [&_svg]:size-4 [&_svg]:shrink-0 transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none data-[active=true]:bg-fd-primary/10 data-[active=true]:text-fd-primary data-[active=true]:hover:transition-colors";
const nested =
  "data-[active=true]:before:content-[''] data-[active=true]:before:bg-fd-primary data-[active=true]:before:absolute data-[active=true]:before:w-px data-[active=true]:before:inset-y-2.5 data-[active=true]:before:inset-s-2.5";
const offset = (depth: number) => ({
  paddingInlineStart: `calc(${2 + 3 * depth} * var(--spacing))`,
});

const normalize = (url: string) =>
  url.length > 1 && url.endsWith("/") ? url.slice(0, -1) : url;

function Item({ item }: { item: PageTree.Item }) {
  const pathname = usePathname();
  const depth = useFolderDepth();
  return (
    <li>
      <SidebarItem
        href={item.url}
        external={item.external}
        active={normalize(item.url) === normalize(pathname)}
        icon={item.icon}
        className={depth >= 1 ? `${row} ${nested}` : row}
        style={offset(depth)}
      >
        {item.name}
      </SidebarItem>
    </li>
  );
}

function Folder({
  item,
  children,
}: {
  item: PageTree.Folder;
  children: ReactNode;
}) {
  const headingId = useId();
  const pathname = usePathname();
  const path = useTreePath();
  const depth = useFolderDepth();
  if (item.$id === NAV_FOLDER)
    return (
      <nav aria-label="Documentation">
        <ul className="flex flex-col gap-0.5">{children}</ul>
      </nav>
    );
  if (item.$id?.startsWith(GROUP_FOLDER))
    return (
      <li className="mt-6 first:mt-0">
        <h2
          id={headingId}
          className="docs-sidebar-group mb-1 flex items-center gap-2 px-2"
        >
          {item.name}
        </h2>
        <ul className="flex flex-col gap-0.5">{children}</ul>
      </li>
    );
  // A folder of pages (MCP tools): a link to its overview that also opens
  // and closes its list.
  return (
    <li>
      <SidebarFolder
        collapsible={item.collapsible}
        active={path.includes(item)}
        defaultOpen={item.defaultOpen}
      >
        {item.index ? (
          <SidebarFolderLink
            href={item.index.url}
            active={normalize(item.index.url) === normalize(pathname)}
            external={item.index.external}
            className={`${row} w-full`}
            style={offset(depth)}
          >
            {item.icon}
            {item.name}
          </SidebarFolderLink>
        ) : (
          <SidebarFolderTrigger
            className={`${row} w-full`}
            style={offset(depth)}
          >
            {item.icon}
            {item.name}
          </SidebarFolderTrigger>
        )}
        <SidebarFolderContent className="before:bg-fd-border relative before:absolute before:inset-y-1 before:inset-s-2.5 before:w-px before:content-['']">
          <ul className="flex flex-col gap-0.5 pt-0.5">{children}</ul>
        </SidebarFolderContent>
      </SidebarFolder>
    </li>
  );
}

export const sidebarComponents = { Item, Folder };

// Fumadocs' breadcrumb, without the folders that only shape the sidebar: a
// page under "Concepts" shows no trail, as before; one in "MCP tools" shows
// that folder.
export function Breadcrumb({
  includeRoot,
  includeSeparator,
  includePage,
  className,
  ...props
}: BreadcrumbProps) {
  const path = useTreePath();
  const { root } = useTreeContext();
  const items = useMemo(
    () =>
      getBreadcrumbItemsFromPath(
        root,
        path.filter((node) => !isLayoutFolder(node)),
        { includePage, includeSeparator, includeRoot },
      ),
    [includePage, includeRoot, includeSeparator, path, root],
  );
  if (items.length === 0) return null;
  return (
    <div
      {...props}
      className={`text-fd-muted-foreground flex items-center gap-1.5 text-sm ${className ?? ""}`}
    >
      {items.map((item, i) => {
        const last = i === items.length - 1;
        const style = `truncate${last ? " text-fd-primary font-medium" : ""}`;
        return (
          <Fragment key={i}>
            {i !== 0 && <ChevronRight className="size-3.5 shrink-0" />}
            {item.url ? (
              <Link
                href={item.url}
                className={`${style} transition-opacity hover:opacity-80`}
              >
                {item.name}
              </Link>
            ) : (
              <span className={style}>{item.name}</span>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
