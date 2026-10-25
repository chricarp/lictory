import {
  identifier,
  identifierPattern,
  views,
  type Project,
} from "@lictory/core/lib/work-items";

export const productName = "Lictory";

type TitleContext = {
  organization: { name: string };
  // The project named by the route, when any.
  project: Project | undefined;
  // The open item, once the store has it.
  item: { title: string; number: number } | undefined;
};

// The browser title for a workspace route: what the page is about, then the
// project or organization it belongs to, then the product. Derived from the
// pathname so the title stays correct while the shell stays mounted across
// client navigations.
export function workspaceTitle(pathname: string, ctx: TitleContext) {
  const [, ...rest] = pathname.split("/").filter(Boolean); // org, ...
  const [first, second, third] = rest;
  const parts: string[] = [];
  const context = ctx.project?.name ?? ctx.organization.name;
  switch (first) {
    case undefined:
      break;
    case "intelligence":
      parts.push("Litto", ctx.organization.name);
      break;
    case "inbox":
      parts.push("Inbox", ctx.organization.name);
      break;
    case "settings":
      parts.push("Settings", ctx.organization.name);
      break;
    case "account":
      parts.push("Account");
      break;
    case "items":
      if (second) parts.push(decodeURIComponent(second).toUpperCase());
      break;
    default: {
      // Project-scoped surfaces.
      if (second === undefined) parts.push(context);
      else if (second === "epics" || second === "stories") {
        if (third === undefined)
          parts.push(second === "epics" ? "Epics" : "Work items", context);
        else {
          const title = itemTitle(third, ctx);
          if (title) parts.push(title);
          parts.push(context);
        }
      } else if (second === "reviews") parts.push("Needs my review", context);
      else if (second === "views" && third) {
        const view = views.find((v) => v.id === third);
        parts.push(view?.label ?? "View", context);
      } else parts.push(context);
    }
  }
  if (!parts.length) parts.push(ctx.organization.name);
  return [...parts, productName].join(" · ");
}

function itemTitle(segment: string, ctx: TitleContext) {
  if (ctx.item) {
    const id = identifier(ctx.project, ctx.item.number);
    return ctx.item.title ? `${id} ${ctx.item.title}` : id;
  }
  const raw = decodeURIComponent(segment);
  // A UUID (right after creation) is not a useful title; the item arrives
  // from the store a moment later.
  return identifierPattern.test(raw) ? raw.toUpperCase() : undefined;
}
