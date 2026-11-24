import { Factory } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  AgentMark,
  SessionStatusBadge,
} from "@lictory/platform/components/factory/parts";
import {
  useFactory,
  waitingOnMe,
} from "@lictory/platform/components/factory/store";

// Integration points for the app shell (sidebar) and Home. The shell owns
// their placement; these components own what they show.

// The Factory's sidebar entry, with how many questions agents are waiting
// for me to answer.
export function FactoryNavSection({
  active,
  collapsed = false,
}: {
  active: boolean;
  collapsed?: boolean;
}) {
  const { organization, userId } = useWorkspace();
  const { sessions, agentById } = useFactory();
  const waiting = waitingOnMe(sessions, agentById, userId).reduce(
    (count, s) => count + s.approvals.length,
    0,
  );
  const label = "Factory";
  return (
    <Link
      href={factoryPaths.overview(organization.slug)}
      aria-current={active ? "page" : undefined}
      aria-label={waiting ? `${label}, ${waiting} waiting on you` : label}
      title={collapsed ? label : undefined}
      className={cn(
        "relative flex items-center rounded-lg text-[13px] transition-[background-color,color,box-shadow] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        collapsed ? "size-8 justify-center" : "h-8 gap-2.5 px-2.5",
        active
          ? "bg-sidebar-accent font-medium text-foreground shadow-(--shadow-border)"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
    >
      <Factory className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {waiting > 0 && (
        <span
          aria-hidden
          className={cn(
            "grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] font-semibold text-background tabular-nums",
            collapsed && "absolute -top-0.5 -right-0.5",
          )}
        >
          {waiting}
        </span>
      )}
    </Link>
  );
}

// A Home card: sessions at work right now, the ones waiting on me first.
export function RunningSessionsCard({ limit = 5 }: { limit?: number }) {
  const { organization, userId } = useWorkspace();
  const { sessions, agentById } = useFactory();
  const mine = new Set(
    waitingOnMe(sessions, agentById, userId).map((s) => s.id),
  );
  const working = sessions
    .filter((s) => ["assigned", "running", "waiting"].includes(s.status))
    .sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)));
  if (!working.length) return null;
  const org = organization.slug;
  return (
    <section
      aria-labelledby="factory-running"
      className="rounded-xl bg-card p-3 shadow-(--shadow-border)"
    >
      <div className="mb-1 flex items-center gap-2 px-1">
        <h2 id="factory-running" className="text-[13px] font-medium">
          Agents at work
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {working.length}
        </span>
        <div className="flex-1" />
        <Link
          href={factoryPaths.overview(org)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Factory
        </Link>
      </div>
      <ul>
        {working.slice(0, limit).map((session) => (
          <li key={session.id}>
            <Link
              href={factoryPaths.session(org, session.id)}
              className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <AgentMark agent={agentById.get(session.agentId)} />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {session.title}
              </span>
              <SessionStatusBadge session={session} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
