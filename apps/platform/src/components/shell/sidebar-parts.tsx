import {
  createContext,
  useCallback,
  useContext,
  useId,
  type ReactNode,
} from "react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import {
  Link,
  useLinkStatus,
  usePathname,
} from "@lictory/platform/lib/navigation";
import { usePanelCollapsed } from "@lictory/platform/lib/panel-preference";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type { NavBadge } from "@lictory/platform/components/shell/nav-registry";

// The building blocks every sidebar section is made of. They draw both the
// full sidebar and the compact one (icons only), so a module writes its
// section once.

// True inside the compact (icon-only) sidebar.
export const CompactSidebarContext = createContext(false);
export function useCompactSidebar() {
  return useContext(CompactSidebarContext);
}

// Whether an address is the current page (or, unless `exact`, one of its
// subpages).
export function useNavActive() {
  const pathname = usePathname();
  return useCallback(
    (href: string, exact = false) =>
      exact
        ? pathname === href
        : pathname === href || pathname.startsWith(`${href}/`),
    [pathname],
  );
}

const captionClass =
  "font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase";

// A captioned group of rows. With `id` the caption folds the group away and
// the choice is remembered in this browser. The compact sidebar draws a
// divider instead of the caption.
export function SidebarGroup({
  id,
  label,
  badge,
  actions,
  children,
  className,
  defaultOpen = true,
}: {
  // Remembers whether the group is folded (per organization).
  id?: string;
  label: string;
  // Shown on the caption while the group is folded, so a count never hides.
  badge?: NavBadge | null;
  // Small buttons beside the caption (New channel).
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  // Folded until opened, for groups most people rarely need.
  defaultOpen?: boolean;
}) {
  const compact = useCompactSidebar();
  if (compact)
    return (
      <div className={cn("space-y-0.5", className)}>
        <div aria-hidden className="mx-1 mb-1.5 border-t" />
        {children}
      </div>
    );
  if (!id)
    return (
      <div className={className}>
        <div className="mb-0.5 flex h-6 items-center gap-1 pl-2">
          <p className={cn(captionClass, "min-w-0 flex-1 truncate")}>{label}</p>
          {actions}
        </div>
        <div className="space-y-0.5">{children}</div>
      </div>
    );
  return (
    <FoldingGroup
      id={id}
      label={label}
      badge={badge}
      actions={actions}
      className={className}
      defaultOpen={defaultOpen}
    >
      {children}
    </FoldingGroup>
  );
}

function FoldingGroup({
  id,
  label,
  badge,
  actions,
  children,
  className,
  defaultOpen,
}: {
  id: string;
  label: string;
  badge?: NavBadge | null;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  defaultOpen: boolean;
}) {
  const { organization } = useWorkspace();
  // The stored flag means "not the default": folded for groups open by
  // default, unfolded for the others.
  const [flipped, toggle] = usePanelCollapsed(
    organization.id,
    `sidebar-section:${id}`,
  );
  const open = defaultOpen ? !flipped : flipped;
  return (
    <Collapsible open={open} onOpenChange={toggle} className={className}>
      <div className="mb-0.5 flex h-6 items-center gap-1">
        <CollapsibleTrigger
          className={cn(
            captionClass,
            "group flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md px-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronRight
            aria-hidden
            className="size-3 shrink-0 opacity-0 transition-[transform,opacity] duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-open:rotate-90 motion-reduce:transition-none"
          />
          {!open && badge && badge.count > 0 && (
            <NavCount badge={badge} className="ml-auto" />
          )}
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsiblePanel className="space-y-0.5">{children}</CollapsiblePanel>
    </Collapsible>
  );
}

// A small square button beside a group's caption.
export function SidebarAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

// A count beside a row: strong counts are filled, quiet ones are text.
function NavCount({
  badge,
  className,
}: {
  badge: NavBadge;
  className?: string;
}) {
  const compact = useCompactSidebar();
  const text = badge.count > 99 ? "99+" : String(badge.count);
  if (compact)
    return (
      <span
        className={cn(
          "absolute -top-0.5 -right-1 h-4 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold tabular-nums ring-2 ring-sidebar",
          badge.tone === "strong"
            ? "bg-primary text-primary-foreground"
            : "bg-muted-foreground/80 text-background",
          className,
        )}
      >
        {text}
      </span>
    );
  return (
    <span
      className={cn(
        "ml-auto shrink-0 rounded-full px-1.5 text-[10.5px] leading-4 font-semibold tabular-nums",
        badge.tone === "strong"
          ? "bg-foreground text-background"
          : "text-muted-foreground",
        className,
      )}
    >
      {text}
    </span>
  );
}

// One destination in the sidebar. Named by its label; a badge describes it
// ("Inbox", described as "3 unread").
export function SidebarLink({
  href,
  active,
  icon,
  children,
  badge,
  trailing,
  unread = false,
}: {
  href: string;
  active: boolean;
  icon?: ReactNode;
  children: string;
  badge?: NavBadge | null;
  // Anything else at the end of the row (a status dot).
  trailing?: ReactNode;
  // New activity since I last looked (a channel): the row reads bold.
  unread?: boolean;
}) {
  const compact = useCompactSidebar();
  const badgeId = useId();
  const shown = badge && badge.count > 0 ? badge : null;
  return (
    <Link
      href={href}
      aria-describedby={shown ? badgeId : undefined}
      title={compact ? children : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center rounded-lg text-[13px] transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none",
        compact ? "size-8 justify-center" : "h-[30px] gap-2.5 px-2",
        // The current page is a raised card on the shell.
        active
          ? "bg-sidebar-accent font-medium text-foreground shadow-(--shadow-border)"
          : unread
            ? "font-semibold text-foreground hover:bg-sidebar-accent/70"
            : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      {icon ? (
        // Decorative next to the label (type icons are named images).
        <span
          aria-hidden
          className={cn(
            "grid size-4 shrink-0 place-items-center [&_svg]:size-4",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {icon}
        </span>
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <span className={compact ? "sr-only" : "min-w-0 flex-1 truncate"}>
        {children}
        {unread && <span className="sr-only">, unread</span>}
      </span>
      {!compact && trailing}
      {shown && (
        // Hidden from the link's name, referenced as its description.
        <span id={badgeId} aria-hidden className="contents">
          <NavCount badge={shown} />
          <span className="sr-only">{` ${shown.label}`}</span>
        </span>
      )}
      <PendingHint />
    </Link>
  );
}

// A line of quiet text inside a group (an empty list, a hint).
export function SidebarNote({ children }: { children: ReactNode }) {
  const compact = useCompactSidebar();
  if (compact) return null;
  return (
    <p className="px-2 py-1 text-xs leading-5 text-muted-foreground">
      {children}
    </p>
  );
}

// Immediate acknowledgement for a pressed link whose route is still loading
// (cold prefetch, slow network). Must render inside the <Link>.
function PendingHint() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="link-pending absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
    />
  );
}
