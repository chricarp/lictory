import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { Plus } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { popupContainer } from "@lictory/ui/popup";
import { Link } from "@lictory/platform/lib/navigation";
import { useSessionState } from "@lictory/platform/lib/session";
import { OrganizationMark } from "@lictory/platform/components/workspace/organization-logo";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useUnread } from "@lictory/platform/components/shell/unread";

const tile =
  "relative grid size-8 place-items-center rounded-[9px] outline-none transition-[background-color,box-shadow,transform] duration-150 focus-ring active:scale-[0.96] motion-reduce:transition-none";

// Every organization I belong to, as its mark, with a way to add another.
// One organization reads as the app's anchor; several switch like Slack
// workspaces. (⌘1 to ⌘9 belong to the desktop app, which switches servers.)
export function OrganizationRail() {
  const { organization, directory } = useWorkspace();
  const organizations = directory.organizations;
  const sessionUser = useSessionState().session?.user;
  const unread = useUnread();
  return (
    <nav
      aria-label="Organizations"
      className="flex w-12 shrink-0 flex-col items-center gap-2 py-2"
    >
      <ul className="flex flex-col items-center gap-2">
        {organizations.map((o) => (
          <li key={o.id}>
            <OrganizationTile
              organization={o}
              current={o.id === organization.id}
              unread={o.id === organization.id ? 0 : (unread[o.id] ?? 0)}
            />
          </li>
        ))}
      </ul>
      {sessionUser?.canCreateOrganization && (
        <RailTooltip label="Create organization">
          <Link
            href={paths.newOrganization}
            className={cn(
              tile,
              "text-muted-foreground shadow-(--shadow-border) hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Plus className="size-4" aria-hidden />
          </Link>
        </RailTooltip>
      )}
    </nav>
  );
}

function OrganizationTile({
  organization,
  current,
  unread,
}: {
  organization: {
    id: string;
    slug: string;
    name: string;
    logos: { mark: string | null; full: string | null };
  };
  current: boolean;
  unread: number;
}) {
  // The tooltip describes the tile, with its unread notifications.
  return (
    <RailTooltip
      label={
        unread > 0
          ? `${organization.name} · ${unread} unread`
          : organization.name
      }
      described
    >
      <Link
        href={paths.org(organization.slug)}
        aria-current={current ? "true" : undefined}
        className={cn(
          tile,
          current
            ? "shadow-[0_0_0_2px_var(--sidebar),0_0_0_4px_var(--ring)]"
            : "opacity-80 hover:opacity-100",
        )}
      >
        <OrganizationMark
          organization={organization}
          className="size-8 rounded-[9px] text-[13px]"
        />
        {/* Named by its content, not an aria-label over the one-letter
            mark, which voice control could not match to what is shown. */}
        <span className="sr-only">{organization.name}</span>
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-sidebar"
          />
        )}
      </Link>
    </RailTooltip>
  );
}

// Names its icon-only trigger, beside the rail, or describes one named by
// its own content (an organization, whose tooltip adds unread counts).
function RailTooltip({
  label,
  described = false,
  children,
}: {
  // What the tooltip shows.
  label: string;
  described?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip
      delay={150}
      container={popupContainer()}
      type={described ? "description" : "label"}
    >
      <TooltipTrigger render={children} />
      <TooltipContent
        side="right"
        sideOffset={8}
        className="z-50 m-0 rounded-md border bg-popover px-2 py-1 text-xs leading-4 font-medium whitespace-pre text-popover-foreground shadow-(--shadow-panel) transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
