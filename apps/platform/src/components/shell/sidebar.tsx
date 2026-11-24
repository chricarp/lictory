import { useRef, useSyncExternalStore } from "react";
import {
  Check,
  ChevronsUpDown,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShieldUser,
  SquarePen,
  UserRound,
} from "lucide-react";
import { PrivacyPreferencesButton } from "@lictory/ui/consent/consent-ui";
import { APP_VERSION } from "@lictory/core/lib/app-version";
import { analyticsConfigured } from "@lictory/core/lib/analytics/client";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@lictory/ui/menu";
import { Avatar, Kbd } from "@lictory/ui/primitives";
import { Link, usePathname, useRouter } from "@lictory/platform/lib/navigation";
import { useSessionState } from "@lictory/platform/lib/session";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { SyncStatus } from "@lictory/platform/components/workspace/sync-status";
import { OrganizationMark } from "@lictory/platform/components/workspace/organization-logo";
import { navSections } from "@lictory/platform/components/shell/nav-registry";
import { useNavBadges } from "@lictory/platform/components/shell/nav-badges";
import {
  CompactSidebarContext,
  SidebarLink,
} from "@lictory/platform/components/shell/sidebar-parts";

export type SidebarUser = {
  name: string;
  email: string;
  handle: string | null;
  image?: string | null;
};

const noSubscribe = () => () => undefined;
const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iP(hone|ad)/.test(navigator.platform);

// The sidebar: the organization, search and create, the registered sections
// in order, then settings and my account. `compact` draws icons only.
export function Sidebar({
  compact = false,
  user,
  onCreate,
  onSearch,
  onCollapse,
  sidebarId,
  onSignOut,
}: {
  compact?: boolean;
  user: SidebarUser;
  // Absent when my disciplines cannot create work items here.
  onCreate?: () => void;
  onSearch: () => void;
  // Absent in the phone drawer, which closes instead.
  onCollapse?: () => void;
  sidebarId: string;
  onSignOut: () => Promise<void>;
}) {
  const { organization } = useWorkspace();
  const badges = useNavBadges();
  const pathname = usePathname();
  const org = organization.slug;
  const settingsHref = paths.settings(org);
  const shortcut = useSyncExternalStore(
    noSubscribe,
    () => (isMac() ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
  return (
    <CompactSidebarContext value={compact}>
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 px-2",
          compact ? "flex-col pt-2" : "h-12 pt-1",
        )}
      >
        <OrganizationMenu compact={compact} />
        {onCollapse && (
          <button
            type="button"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
              !compact && "max-lg:hidden",
            )}
            data-sidebar-toggle
            aria-keyshortcuts="["
            aria-label={compact ? "Expand app sidebar" : "Collapse app sidebar"}
            title={`${compact ? "Expand app sidebar" : "Collapse app sidebar"}  [`}
            aria-expanded={!compact}
            aria-controls={sidebarId}
            onClick={onCollapse}
          >
            {compact ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <PanelLeftClose className="size-4" aria-hidden />
            )}
          </button>
        )}
      </div>
      <div
        className={cn(
          "flex shrink-0 gap-1 px-2 pb-2",
          compact ? "flex-col items-center pt-1" : "items-center pt-1",
        )}
      >
        <button
          type="button"
          aria-label={compact ? "Search Lictory" : undefined}
          aria-keyshortcuts="Meta+K Control+K /"
          title={compact ? `Search  ${shortcut}` : undefined}
          onClick={onSearch}
          className={cn(
            "flex items-center gap-2 rounded-lg text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
            compact
              ? "size-8 justify-center hover:bg-sidebar-accent"
              : "h-8 min-w-0 flex-1 bg-sidebar-accent/60 px-2 shadow-(--shadow-border) hover:bg-sidebar-accent",
          )}
        >
          <Search className="size-4 shrink-0" aria-hidden />
          {!compact && (
            <>
              <span className="min-w-0 flex-1 truncate text-left">Search…</span>
              <span aria-hidden className="flex items-center gap-0.5">
                <Kbd>{shortcut}</Kbd>
              </span>
            </>
          )}
        </button>
        {onCreate && (
          <button
            type="button"
            aria-label="Create work item"
            title="New item  C"
            aria-keyshortcuts="C"
            onClick={onCreate}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              compact
                ? "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
                : "bg-sidebar-accent text-foreground shadow-(--shadow-border) hover:shadow-(--shadow-border-hover)",
            )}
          >
            <SquarePen className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <nav
        aria-label="Workspace"
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-2 pb-2",
          compact ? "items-center gap-1.5" : "gap-3.5",
        )}
      >
        {navSections.map((section, index) => (
          <div
            key={section.id}
            data-nav-section={section.id}
            className={cn(
              "space-y-0.5",
              compact && "flex flex-col items-center",
              // Home and Inbox sit together at the top.
              !compact && index === 1 && "-mt-3",
            )}
          >
            <section.Section badge={badges.get(section.id) ?? null} />
          </div>
        ))}
        <div
          className={cn(
            "mt-auto pt-2",
            compact && "flex flex-col items-center",
          )}
        >
          <SidebarLink
            href={settingsHref}
            active={
              pathname === settingsHref ||
              pathname.startsWith(`${settingsHref}/`)
            }
            icon={<Settings />}
          >
            Organization settings
          </SidebarLink>
        </div>
      </nav>
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 border-t border-sidebar-border py-2",
          compact ? "flex-col px-2" : "px-2",
        )}
      >
        <AccountMenu user={user} compact={compact} onSignOut={onSignOut} />
        <SyncStatus />
      </div>
    </CompactSidebarContext>
  );
}

// The organization I am in, with switching, its settings and creating
// another. The rail beside the full sidebar switches with one click; this
// menu also works in the compact sidebar and on phones.
function OrganizationMenu({ compact }: { compact: boolean }) {
  const { organization, directory } = useWorkspace();
  const router = useRouter();
  const sessionUser = useSessionState().session?.user;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={
              compact ? `Switch organization: ${organization.name}` : undefined
            }
            title={compact ? organization.name : undefined}
            className={cn(
              "flex h-8 min-w-0 items-center gap-2 rounded-lg text-left text-[13px] font-semibold outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60",
              compact ? "size-8 justify-center" : "flex-1 px-2",
            )}
          />
        }
      >
        {compact ? (
          <OrganizationMark organization={organization} />
        ) : !organization.logos.full ? (
          <>
            {/* Beside the rail (wide windows) the name is enough. */}
            <OrganizationMark
              organization={organization}
              className="min-[96rem]:hidden"
            />
            <span className="truncate">{organization.name}</span>
          </>
        ) : (
          // The full logo already contains the name; keep it for
          // assistive technology.
          <>
            <img
              src={organization.logos.full}
              alt=""
              aria-hidden
              className="h-5 max-w-[150px] min-w-0 shrink object-contain object-left"
            />
            <span className="sr-only">{organization.name}</span>
          </>
        )}
        {!compact && (
          <ChevronsUpDown className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
        )}
      </MenuTrigger>
      <MenuContent width={240} side={compact ? "right" : "bottom"}>
        <MenuGroup>
          <MenuLabel className="text-[11px] font-medium uppercase">
            Organizations
          </MenuLabel>
          {directory.organizations.map((o) => (
            <MenuItem
              key={o.id}
              label={o.name}
              onSelect={() => router.push(paths.org(o.slug))}
            >
              <OrganizationMark organization={o} className="size-4" />
              <span className="truncate">{o.name}</span>
              {o.id === organization.id && (
                <Check className="ml-auto size-3.5 text-primary" aria-hidden />
              )}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator className="mx-0" />
        <MenuItem render={<Link href={paths.settings(organization.slug)} />}>
          <Settings className="size-3.5" aria-hidden />
          Organization settings
        </MenuItem>
        {sessionUser?.canCreateOrganization && (
          <MenuItem render={<Link href={paths.newOrganization} />}>
            <Plus className="size-3.5" aria-hidden />
            Create organization
          </MenuItem>
        )}
      </MenuContent>
    </Menu>
  );
}

function AccountMenu({
  user,
  compact,
  onSignOut,
}: {
  user: SidebarUser;
  compact: boolean;
  onSignOut: () => Promise<void>;
}) {
  const pathname = usePathname();
  // Instance policy for the menu (the server enforces it either way).
  const sessionUser = useSessionState().session?.user;
  const privacyItem = useRef<HTMLDivElement>(null);
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label={`Account menu: ${user.name || user.email}`}
            title={compact ? `Account: ${user.name || user.email}` : undefined}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-lg p-1 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/60",
              compact ? "size-8 justify-center" : "flex-1",
            )}
          />
        }
      >
        {/* The name already says whose account this is. */}
        <span aria-hidden className="inline-flex shrink-0">
          <Avatar image={user.image} name={user.name || user.email} size="sm" />
        </span>
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {user.name}
            </span>
            <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
          </>
        )}
      </MenuTrigger>
      <MenuContent width={240} side="top">
        <MenuGroup>
          <MenuLabel>
            <span className="block truncate text-[13px] font-medium text-popover-foreground">
              {user.name}
            </span>
            <span className="block truncate">
              {user.handle ? `@${user.handle} · ${user.email}` : user.email}
            </span>
          </MenuLabel>
          <MenuSeparator className="mx-0" />
          {/* Leaving the workspace: the menu stays until the page it links
              to has loaded. */}
          <MenuItem
            closeOnSelect={false}
            render={<Link href={paths.account(pathname)} />}
          >
            <UserRound className="size-3.5 text-muted-foreground" /> Account
            settings
          </MenuItem>
          {sessionUser?.instanceAdmin && (
            <MenuItem
              closeOnSelect={false}
              render={<Link href={paths.admin()} />}
            >
              <ShieldUser className="size-3.5 text-muted-foreground" /> Admin
              console
            </MenuItem>
          )}
          {analyticsConfigured() && (
            <MenuItem
              ref={privacyItem}
              render={<PrivacyPreferencesButton />}
              // The button opens the preferences from its click, and a key
              // press chooses an item without one.
              onSelect={(event) => {
                if (event.type === "click") return;
                event.preventDefault();
                privacyItem.current?.click();
              }}
            >
              <ShieldCheck className="size-3.5 text-muted-foreground" /> Privacy
              preferences
            </MenuItem>
          )}
          <MenuItem onSelect={onSignOut}>
            <LogOut className="size-3.5 text-muted-foreground" /> Sign out
          </MenuItem>
        </MenuGroup>
        <div
          className="mt-1 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground"
          title="Major version · feature release · fixes"
        >
          Lictory <span className="tabular-nums">v{APP_VERSION}</span>
        </div>
      </MenuContent>
    </Menu>
  );
}
