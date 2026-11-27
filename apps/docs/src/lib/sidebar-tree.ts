import type * as PageTree from "fumadocs-core/page-tree";

// The sidebar reads as navigation, with each group of pages a heading and a
// list (WCAG 1.3.1). Fumadocs draws a meta.json separator ("---Concepts---")
// as a paragraph among the links, so the tree handed to the layout wraps
// every page in one folder (rendered as the <nav>) and each separator's
// pages in a folder of their own (a heading and a list). The order is
// unchanged, so previous/next links are the same; the breadcrumb skips these
// folders (components/sidebar.tsx).

export const NAV_FOLDER = "lictory-docs:nav";
export const GROUP_FOLDER = "lictory-docs:group:";

export function isLayoutFolder(node: PageTree.Node) {
  return (
    node.type === "folder" &&
    (node.$id === NAV_FOLDER || !!node.$id?.startsWith(GROUP_FOLDER))
  );
}

export function groupedTree(tree: PageTree.Root): PageTree.Root {
  const top: PageTree.Node[] = [];
  let group: PageTree.Folder | undefined;
  for (const node of tree.children) {
    if (node.type === "separator") {
      const name = typeof node.name === "string" ? node.name : "";
      group = {
        type: "folder",
        $id: `${GROUP_FOLDER}${name}`,
        name: node.name ?? "",
        collapsible: false,
        defaultOpen: true,
        children: [],
      };
      top.push(group);
    } else if (group) group.children.push(node);
    else top.push(node);
  }
  return {
    ...tree,
    $id: `${tree.$id ?? "root"}:grouped`,
    children: [
      {
        type: "folder",
        $id: NAV_FOLDER,
        name: "Documentation",
        collapsible: false,
        defaultOpen: true,
        children: top,
      },
    ],
  };
}
