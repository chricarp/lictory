import { useState, type ReactNode } from "react";
import { Bot, Check, X } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { policyStarter } from "@lictory/core/claims/contracts";
import {
  sessionTitle,
  type AgentEntity,
  type ApprovalEntity,
  type SessionEntity,
} from "@lictory/core/factory/entities";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Badge } from "@lictory/ui/primitives";
import { toast } from "@lictory/ui/toast";
import { Link, usePathname } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { factoryPaths } from "@lictory/platform/components/factory/paths";
import {
  statusLabels,
  statusMeaning,
  statusTone,
} from "@lictory/platform/components/factory/labels";

// Pieces shared by the Factory's pages.

// Who started a session: the person, or "Build policy (set by Ada)" for a
// session an autonomy policy started (its owner stays accountable).
export function useSessionStarter() {
  const { memberName } = useWorkspace();
  return (session: Pick<SessionEntity, "requestedById" | "startedByPolicy">) =>
    session.startedByPolicy
      ? policyStarter(
          session.startedByPolicy,
          memberName(session.startedByPolicy.setById),
        )
      : memberName(session.requestedById);
}

export function FactoryPage({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { organization } = useWorkspace();
  const pathname = usePathname();
  const org = organization.slug;
  const tabs = [
    { href: factoryPaths.overview(org), label: "Overview", exact: true },
    { href: factoryPaths.agents(org), label: "Agents" },
    { href: factoryPaths.runners(org), label: "Runners" },
  ];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-8 sm:pt-8">
        <header className="flex flex-wrap items-start gap-x-3 gap-y-4">
          <div className="min-w-0 flex-1 basis-64">
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
        <nav aria-label="Factory" className="mt-5 flex gap-1 border-b">
          {tabs.map((tab) => {
            const current = tab.exact
              ? pathname === tab.href
              : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 px-3 pb-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  current
                    ? "border-foreground font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

export function SessionStatusBadge({ session }: { session: SessionEntity }) {
  return (
    <span title={statusMeaning(session.status)}>
      <Badge tone={statusTone[session.status]}>
        {(session.status === "running" || session.status === "assigned") && (
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none"
          />
        )}
        {statusLabels[session.status]}
      </Badge>
    </span>
  );
}

export function AgentMark({
  agent,
  className,
}: {
  agent: Pick<AgentEntity, "avatar" | "name"> | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md bg-muted text-[13px] text-muted-foreground ring-1 ring-foreground/8",
        className,
      )}
    >
      {agent?.avatar?.length ? agent.avatar : <Bot className="size-3.5" />}
    </span>
  );
}

// "Forge via Ada": an agent always acts for its owner.
export function AgentName({ agent }: { agent: AgentEntity | undefined }) {
  const { memberName } = useWorkspace();
  if (!agent)
    return <span className="text-muted-foreground">Unknown agent</span>;
  return (
    <span className="min-w-0 truncate">
      <span className="font-medium text-foreground">{agent.name}</span>
      <span className="text-muted-foreground">
        {" "}
        via {memberName(agent.ownerId)}
      </span>
    </span>
  );
}

export function SessionRow({
  session,
  agent,
}: {
  session: SessionEntity;
  agent: AgentEntity | undefined;
}) {
  const { organization } = useWorkspace();
  const starter = useSessionStarter();
  return (
    <li>
      <Link
        href={factoryPaths.session(organization.slug, session.id)}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <AgentMark agent={agent} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">
            {sessionTitle(session.title)}
          </div>
          <div className="mt-0.5 flex min-w-0 gap-1 text-xs text-muted-foreground">
            <span className="truncate">
              {agent?.name ?? "Agent"} · started by {starter(session)}
            </span>
          </div>
        </div>
        <SessionStatusBadge session={session} />
        <time
          dateTime={session.updatedAt}
          className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block"
        >
          {relativeTime(session.updatedAt)}
        </time>
      </Link>
    </li>
  );
}

export function SessionList({
  sessions,
  agentById,
  empty,
}: {
  sessions: SessionEntity[];
  agentById: ReadonlyMap<string, AgentEntity>;
  empty?: ReactNode;
}) {
  if (!sessions.length)
    return empty ? (
      <p className="px-3 py-4 text-[13px] text-muted-foreground">{empty}</p>
    ) : null;
  return (
    <ul className="divide-y divide-border/60 rounded-xl bg-card shadow-(--shadow-border)">
      {sessions.map((s) => (
        <SessionRow key={s.id} session={s} agent={agentById.get(s.agentId)} />
      ))}
    </ul>
  );
}

export function Section({
  title,
  count,
  action,
  children,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          {title}
        </h2>
        {count !== undefined && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {count}
          </span>
        )}
        <div className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

// Approve or Deny what an agent asked. Only the person who started the
// session or the agent's owner sees the buttons; the server decides anyway.
export function ApprovalActions({
  session,
  approval,
  canAnswer,
}: {
  session: SessionEntity;
  approval: ApprovalEntity;
  canAnswer: boolean;
}) {
  const { organization } = useWorkspace();
  const [sent, setSent] = useState<"approve" | "deny" | null>(null);
  if (!canAnswer)
    return (
      <p className="text-xs text-muted-foreground">
        Waiting for the person who started the session or the agent’s owner.
      </p>
    );
  const answer = async (decision: "approve" | "deny") => {
    setSent(decision);
    try {
      await callCapability("answerAgentApproval", {
        organizationId: organization.id,
        sessionId: session.id,
        approvalId: approval.id,
        decision,
      });
    } catch (error) {
      setSent(null);
      toast({
        type: "error",
        title: "The answer was not recorded",
        description: (error as Error).message,
      });
    }
  };
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        onClick={() => answer("approve")}
        disabled={sent !== null}
      >
        <Check className="size-3.5" aria-hidden /> Approve
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => answer("deny")}
        disabled={sent !== null}
      >
        <X className="size-3.5" aria-hidden /> Deny
      </Button>
    </div>
  );
}

export function canAnswerSession(
  session: SessionEntity,
  agent: AgentEntity | undefined,
  userId: string,
) {
  return session.requestedById === userId || agent?.ownerId === userId;
}
