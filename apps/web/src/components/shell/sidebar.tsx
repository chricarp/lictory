"use client";

import {
  ArrowLeft,
  Home,
  LogOut,
  Menu,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "@/components/ui/icons";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import { BulbIcon } from "@/components/ui/animated/bulb";
import { Calendar03Icon } from "@/components/ui/animated/calendar-03";
import { Edit02Icon } from "@/components/ui/animated/edit-02";
import { File01Icon } from "@/components/ui/animated/file-01";
import { Location01Icon } from "@/components/ui/animated/location-01";
import { UserIcon } from "@/components/ui/animated/user";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  KEYBINDINGS,
  Keybinding,
  type KeybindingDefinition,
  keybindingAria,
} from "@/components/ui/keybinding";
import type { AnimatedIconHandle } from "@/lib/use-icon-animation";
import { authClient } from "@/lib/auth-client";
import { useApi, useResource } from "@/lib/api";
import { useHasLocalCapture } from "@/lib/local-capture";
import { cn } from "@/lib/utils";

type AnimatedSidebarIcon = React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> &
    React.RefAttributes<AnimatedIconHandle> & { size?: number }
>;

export type NavItem = {
  href: string;
  label: string;
  icon: AnimatedSidebarIcon;
  shortcut?: KeybindingDefinition;
};

export const PRIMARY_NAV: NavItem[] = [
  {
    href: "/app",
    label: "Capture",
    icon: Edit02Icon,
    shortcut: KEYBINDINGS.capture,
  },
  { href: "/app/notes", label: "Notes", icon: File01Icon },
];

export const CONTEXT_NAV: NavItem[] = [
  {
    href: "/app/people",
    label: "People",
    icon: UserIcon,
  },
  {
    href: "/app/places",
    label: "Places",
    icon: Location01Icon,
  },
  {
    href: "/app/calendar",
    label: "Moments",
    icon: Calendar03Icon,
  },
  {
    href: "/app/topics",
    label: "Topics",
    icon: BulbIcon,
  },
];

function AccountMenu() {
  const { data: session } = authClient.useSession();
  if (!session) return null;

  const displayName = session.user.name ?? session.user.email ?? "Your account";
  const initials = displayName
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="group flex min-h-12 w-full items-center gap-3 rounded-full px-2.5 py-2 text-left outline-none transition-[background-color,transform] hover:bg-surface-strong active:scale-[0.98] lg:w-fit lg:justify-center xl:w-full xl:justify-start"
          aria-label="Account menu"
        >
          <Avatar className="size-8">
            {session.user.image ? (
              <AvatarImage src={session.user.image} alt="" />
            ) : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 lg:hidden xl:block">
            <span className="block truncate text-[0.9375rem] font-normal text-muted transition-colors group-hover:text-foreground">
              {displayName}
            </span>
          </span>
          <span className="text-sm tracking-wider text-subtle transition-colors group-hover:text-muted lg:hidden xl:block">
            ···
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="min-w-60">
        <DropdownMenuLabel>
          <span className="block truncate text-[0.8125rem] font-medium normal-case tracking-normal text-foreground">
            {session.user.name}
          </span>
          <span className="block truncate text-[0.6875rem] normal-case tracking-normal text-subtle">
            {session.user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/profile">
            <UserRound />
            Profile & preferences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          destructive
          onSelect={() => void authClient.signOut()}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavLink({
  item,
  onNavigate,
  captureInProgress = false,
}: {
  item: NavItem;
  onNavigate?: () => void;
  captureInProgress?: boolean;
}) {
  const pathname = usePathname();
  const active =
    item.href === "/app" ? pathname === "/app" : pathname.startsWith(item.href);
  const Icon = item.icon;
  const iconRef = React.useRef<AnimatedIconHandle>(null);

  React.useEffect(() => {
    if (!active) iconRef.current?.resetAnimation();
  }, [active]);

  return (
    <Link
      href={item.href}
      aria-label={
        item.href === "/app" && captureInProgress
          ? `${item.label}, unsaved capture in progress`
          : item.label
      }
      onClick={() => {
        iconRef.current?.startAnimation();
        onNavigate?.();
      }}
      aria-keyshortcuts={
        item.shortcut ? keybindingAria(item.shortcut) : undefined
      }
      className={cn(
        "relative flex min-h-12 w-fit max-w-full items-center gap-3 rounded-full py-2 pl-2.5 pr-4 text-[0.9375rem] transition-[background-color,color,box-shadow] lg:px-2.5 xl:gap-3.5 xl:pl-3 xl:pr-[1.125rem]",
        active
          ? "bg-surface font-bold text-foreground hover:bg-surface-strong"
          : "font-normal text-muted hover:bg-surface-strong hover:text-foreground",
      )}
    >
      <span className="relative flex size-8 shrink-0 items-center justify-center">
        <Icon
          ref={iconRef}
          size={20}
          className={cn(
            "shrink-0 [&_svg]:block",
            active ? "text-foreground [&_path]:stroke-[2.25]" : "text-muted",
          )}
        />
        {item.href === "/app" && captureInProgress ? (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 size-2 rounded-full bg-ember-bright shadow-[0_0_6px_rgb(var(--ember)/0.55)]"
          />
        ) : null}
      </span>
      <span className="relative lg:hidden xl:inline">{item.label}</span>
      {item.shortcut ? (
        <Keybinding
          binding={item.shortcut}
          className="relative ml-auto lg:hidden xl:inline-flex"
        />
      ) : null}
    </Link>
  );
}

function AskSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const api = useApi();
  const router = useRouter();
  const history = useResource("ask-history", () => api.listAskQueries());
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const refreshHistory = history.refresh;

  React.useEffect(() => {
    const refresh = () => void refreshHistory();
    window.addEventListener("lictory:ask-history-changed", refresh);
    return () =>
      window.removeEventListener("lictory:ask-history-changed", refresh);
  }, [refreshHistory]);

  const deleteQuery = async (queryId: string) => {
    setDeletingId(queryId);
    try {
      await api.deleteAskQuery(queryId);
      history.mutate((current) => ({
        queries: (current?.queries ?? []).filter(
          (query) => query.id !== queryId,
        ),
      }));
      window.dispatchEvent(new Event("lictory:ask-history-changed"));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete that ask",
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          router.back();
        }}
        className="mb-6 flex min-h-11 w-full items-center gap-3 rounded-full border border-hairline px-3.5 py-2.5 text-sm text-muted transition-[background-color,color,transform] hover:bg-surface hover:text-foreground active:scale-[0.98] lg:w-fit xl:w-full"
      >
        <ArrowLeft className="size-4 shrink-0" />
        <span className="lg:hidden xl:inline">Go back</span>
      </button>

      <div className="mb-2 flex items-center gap-2 px-3 lg:hidden xl:flex">
        <Sparkles className="size-3.5 text-ember" />
        <p className="text-xs font-medium text-subtle">Ask history</p>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto lg:w-fit xl:w-full">
        {history.loading ? (
          <div className="space-y-2 px-2 py-1" aria-label="Loading ask history">
            {[0, 1, 2].map((item) => (
              <span
                key={item}
                className="block h-9 w-9 animate-pulse rounded-lg bg-surface xl:h-10 xl:w-full"
              />
            ))}
          </div>
        ) : history.error ? (
          <button
            type="button"
            onClick={() => void history.refresh()}
            className="rounded-lg px-3 py-2 text-left text-xs text-danger lg:size-10 lg:p-0 lg:text-center xl:h-auto xl:w-full xl:p-3"
          >
            <span className="lg:hidden xl:inline">
              Couldn’t load history. Retry
            </span>
            <span className="hidden lg:inline xl:hidden">!</span>
          </button>
        ) : history.data?.queries.length ? (
          history.data.queries.map((query) => (
            <div key={query.id} className="group relative lg:w-10 xl:w-full">
              <Link
                href={`/app/ask?id=${encodeURIComponent(query.id)}`}
                onClick={onNavigate}
                aria-label={query.question}
                className="flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 pr-9 text-xs leading-5 text-muted transition-colors hover:bg-surface hover:text-foreground lg:justify-center lg:gap-0 lg:px-0 xl:block xl:pr-9"
              >
                <Sparkles className="size-4 shrink-0 text-subtle xl:hidden" />
                <span className="line-clamp-2 lg:hidden xl:block">
                  {query.question}
                </span>
              </Link>
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  void deleteQuery(query.id);
                }}
                disabled={deletingId === query.id}
                aria-label={`Delete “${query.question}”`}
                className="absolute right-1.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-subtle opacity-100 transition-[background-color,color,opacity] hover:bg-surface-strong hover:text-danger lg:hidden xl:flex xl:opacity-0 xl:group-hover:opacity-100 xl:focus-visible:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        ) : (
          <p className="px-3 py-2 text-xs leading-5 text-subtle lg:hidden xl:block">
            Questions you ask will stay here.
          </p>
        )}
      </div>
    </div>
  );
}

export function SidebarContent({
  onNavigate,
  onAsk,
}: {
  onNavigate?: () => void;
  onAsk: () => void;
}) {
  const { data: session } = authClient.useSession();
  const captureInProgress = useHasLocalCapture(session?.user.id);
  const pathname = usePathname();
  const askMode = pathname === "/app/ask";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <Link
        href="/"
        className="mb-4 flex w-fit items-center gap-3 rounded-full px-3 py-2 transition-colors hover:bg-surface-strong"
        aria-label="Lictory home"
      >
        <span className="flex size-9 items-center justify-center text-[0.75rem] font-black tracking-[-0.08em] text-foreground">
          LI
        </span>
        <span className="lg:hidden xl:block">
          <span className="block text-[0.9375rem] font-bold tracking-tight">
            Lictory
          </span>
          <span className="block text-[0.6875rem] text-subtle">
            Your memory space
          </span>
        </span>
      </Link>

      {askMode ? (
        <AskSidebar onNavigate={onNavigate} />
      ) : (
        <>
          <button
            type="button"
            onClick={onAsk}
            aria-keyshortcuts={keybindingAria(KEYBINDINGS.search)}
            className="mb-5 flex min-h-11 w-full items-center gap-3 rounded-full bg-surface px-3.5 py-2.5 text-[0.8125rem] text-muted transition-colors hover:bg-surface-strong hover:text-foreground lg:w-fit xl:w-full xl:px-4"
          >
            <Sparkles className="size-4 text-ember" />
            <span className="flex-1 text-left lg:hidden xl:block">Ask</span>
            <Keybinding
              binding={KEYBINDINGS.search}
              className="lg:hidden xl:inline-flex"
            />
          </button>

          <nav className="flex flex-col items-start gap-0.5">
            {PRIMARY_NAV.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                onNavigate={onNavigate}
                captureInProgress={captureInProgress}
              />
            ))}
          </nav>

          <p className="mb-2 mt-6 px-4 text-xs font-medium text-subtle lg:hidden xl:block">
            Browse by
          </p>
          <nav className="flex flex-col items-start gap-0.5 lg:mt-4 xl:mt-0">
            {CONTEXT_NAV.map((item) => (
              <NavLink key={item.href} item={item} onNavigate={onNavigate} />
            ))}
          </nav>
        </>
      )}

      <div className="mt-auto pt-6">
        <AccountMenu />
      </div>
    </div>
  );
}

export function MobileNav({ onAsk }: { onAsk: () => void }) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();

  // Navigating closes the drawer; adjusting during render keeps the close in
  // the same commit as the route change.
  const [lastPath, setLastPath] = React.useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="lg:hidden"
      >
        <Menu />
      </Button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/75 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
            />
            <motion.aside
              className="fixed left-0 top-0 z-50 flex h-dvh w-72 min-h-0 overflow-y-auto overscroll-contain border-r border-hairline bg-canvas px-4 pb-3 pt-16 lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="absolute right-3 top-3"
              >
                <X />
              </Button>
              <SidebarContent
                onNavigate={() => setOpen(false)}
                onAsk={() => {
                  setOpen(false);
                  onAsk();
                }}
              />
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}

export { Home };
