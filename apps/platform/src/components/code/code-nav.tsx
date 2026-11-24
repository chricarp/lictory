import { FolderGit2 } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { cn } from "@lictory/core/lib/utils";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useCodeHosts,
  useCodeList,
} from "@lictory/platform/components/code/store";
import { codePaths } from "@lictory/platform/components/code/parts";

// The Code module's entry in the app's navigation, for the shell's nav
// registry: a link to /$org/code with the number of open pull requests that
// ask the signed-in person for a review (by their code host login). It
// renders nothing until a code host is connected, so the sidebar never
// advertises an empty module.
export function CodeNavSection({ collapsed = false }: { collapsed?: boolean }) {
  const { organization } = useWorkspace();
  const { connections, myLogins } = useCodeHosts();
  const { rows } = useCodeList("codePullRequest", "open");
  const { pathname } = useLocation();
  if (!connections.length) return null;
  const href = codePaths.index(organization.slug);
  const active = pathname.startsWith(`/${organization.slug}/code`);
  const waiting = rows.filter((p) =>
    p.requestedReviewers.some((r) => myLogins.has(r.toLowerCase())),
  ).length;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? "Code" : undefined}
      className={cn(
        "relative flex items-center rounded-lg text-[13px] transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        collapsed ? "size-8 justify-center" : "h-8 gap-2.5 px-2.5",
        active
          ? "bg-sidebar-accent font-medium text-foreground shadow-(--shadow-border)"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <FolderGit2 aria-hidden className="size-4" />
      <span className={collapsed ? "sr-only" : undefined}>Code</span>
      {waiting > 0 && (
        <span
          className={cn(
            "ml-auto text-xs text-muted-foreground tabular-nums",
            collapsed && "sr-only",
          )}
        >
          {waiting}
          <span className="sr-only"> reviews requested</span>
        </span>
      )}
    </Link>
  );
}
