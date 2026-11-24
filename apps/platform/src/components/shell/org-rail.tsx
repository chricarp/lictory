import { useEffect, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import { Plus } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { popupContainer } from "@lictory/ui/popup";
import { desktop } from "@lictory/platform/lib/desktop";
import { Link, useRouter } from "@lictory/platform/lib/navigation";
import { useSessionState } from "@lictory/platform/lib/session";
import { OrganizationMark } from "@lictory/platform/components/workspace/organization-logo";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useUnread } from "@lictory/platform/components/shell/unread";

const tile =
  "relative grid size-9 place-items-center rounded-[10px] outline-none transition-[background-color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96] motion-reduce:transition-none";

// Every organization I belong to, as its mark, with a way to add another.
// One organization reads as the app's anchor; several switch like Slack
// workspaces (in the desktop app also with ⌘1 to ⌘9).
export function OrganizationRail() {
  const { organization, directory } = useWorkspace();
  const organizations = directory.organizations;
  const sessionUser = useSessionState().session?.user;
  const unread = useUnread();
  useOrganizationShortcuts(organizations);
  return (
    <nav
      aria-label="Organizations"
      className="flex w-[52px] shrink-0 flex-col items-center gap-2 py-2"
    >
      <ul className="flex flex-col items-center gap-2">
        {organizations.map((o, index) => (
          <li key={o.id}>
            <OrganizationTile
              organization={o}
              current={o.id === organization.id}
              unread={o.id === organization.id ? 0 : (unread[o.id] ?? 0)}
              shortcut={index < 9 && desktop() ? index + 1 : undefined}
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
  shortcut,
}: {
  organization: {
    id: string;
    slug: string;
    name: string;
    logos: { mark: string | null; full: string | null };
  };
  current: boolean;
  unread: number;
  shortcut?: number;
}) {
  // The tooltip describes the tile: unread notifications and the shortcut.
  const details = [
    unread > 0 && `${unread} unread`,
    shortcut &&
      `${desktop()?.platform === "darwin" ? "⌘" : "Ctrl+"}${shortcut}`,
  ].filter(Boolean);
  return (
    <RailTooltip
      label={[organization.name, ...details].join(" · ")}
      name={organization.name}
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
          className="size-9 rounded-[10px] text-sm"
        />
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

// Names its icon-only trigger, beside the rail.
function RailTooltip({
  label,
  name,
  children,
}: {
  // What the tooltip shows.
  label: string;
  // The trigger's accessible name, when it differs from what is shown
  // (a shortcut hint).
  name?: string;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip
      delay={150}
      container={popupContainer()}
      type={name ? "description" : "label"}
    >
      <TooltipTrigger render={children} aria-label={name} />
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

// ⌘1 to ⌘9 (Ctrl on Windows and Linux) open the first nine organizations in
// the desktop app. Browsers keep those keys for their own tabs.
function useOrganizationShortcuts(
  organizations: readonly { id: string; slug: string }[],
) {
  const router = useRouter();
  useEffect(() => {
    const bridge = desktop();
    if (!bridge || organizations.length < 2) return;
    const onKey = (event: KeyboardEvent) => {
      const modifier =
        bridge.platform === "darwin" ? event.metaKey : event.ctrlKey;
      if (!modifier || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      const target = organizations[index];
      if (!Number.isInteger(index) || !target) return;
      event.preventDefault();
      router.push(paths.org(target.slug));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [organizations, router]);
}
