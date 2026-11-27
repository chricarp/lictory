import { asksPermission, sessionTitle } from "@lictory/core/factory/entities";
import { useId, useMemo, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  FileDiff,
  GitBranch,
  MessageCircleQuestion,
  Send,
  Server,
  ShieldQuestion,
  SquareTerminal,
  TriangleAlert,
  X,
} from "lucide-react";
import { Textarea } from "@ui-sdk/react/textarea";
import { callCapability } from "@lictory/core/capabilities/client";
import type {
  AgentEntity,
  ApprovalEntity,
  RunnerEntity,
  SessionEntity,
  SessionEventRow,
} from "@lictory/core/factory/entities";
import { paths } from "@lictory/core/lib/paths";
import { cn } from "@lictory/core/lib/utils";
import { identifier, relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { toast } from "@lictory/ui/toast";
import { Link } from "@lictory/platform/lib/navigation";
import {
  MetaLine,
  MetaPart,
} from "@lictory/platform/components/shell/meta-line";
import { firstName } from "@lictory/platform/lib/session-state";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSessionEvents } from "@lictory/platform/components/factory/store";
import {
  approvalAction,
  type ApprovalAction,
} from "@lictory/platform/components/factory/progress";
import {
  useAutonomy,
  useLiveClaims,
} from "@lictory/platform/components/claims/claims";
import {
  AgentActor,
  AgentAvatar,
  PolicyActor,
} from "@lictory/platform/components/identity/actor";

// An agent asking a person to decide something, with what a person needs to
// decide it: what is asked, who asks (the agent and the person it acts for),
// where (the session, the work item, the branch, the runner) and the
// evidence (the request's own input, the last command, the files changed, the
// diff when there is one). One component wherever approvals appear: a
// channel thread, the transcript, the Factory and Home.
//
// In lists (`compact`) the row's action is Review: it opens the context, and
// Approve appears only then, so nothing is approved from a one-line title.
// A request that names no action (no tool and input) is a question, not a
// permission: it is answered in words or denied, never approved (text is
// never permission). The decision is the server's `answerAgentApproval`
// capability; only the person who started the session or the agent's owner
// may answer, and everyone else sees who decides.

export function canDecide(
  session: Pick<SessionEntity, "requestedById">,
  agent: Pick<AgentEntity, "ownerId"> | undefined,
  userId: string,
) {
  return session.requestedById === userId || agent?.ownerId === userId;
}

type Props = {
  session: SessionEntity;
  approval: ApprovalEntity;
  agent: AgentEntity | undefined;
  runner?: RunnerEntity;
  // A row in a list: one line until Review opens it.
  compact?: boolean;
  // Show the link to the session (off inside the transcript itself).
  linkSession?: boolean;
  // Show the work item (off where the surrounding card already names it).
  linkItem?: boolean;
  // Inside another card (a channel's session card): no card of its own.
  embedded?: boolean;
  // Replaces the server call (the design gallery's examples).
  onDecide?: (
    decision: "approve" | "deny" | "answer",
    note?: string,
  ) => Promise<void>;
};

export function ApprovalRequest({
  compact = false,
  linkSession = true,
  linkItem = true,
  embedded = false,
  ...props
}: Props) {
  const [open, setOpen] = useState(!compact);
  const bodyId = useId();
  const subjectId = useId();
  const { session, approval, agent } = props;
  const { items, projects } = useWorkspace();
  if (!compact)
    return (
      <div
        data-approval-request
        className={cn(
          "[--actor-ring:var(--card)]",
          embedded
            ? "px-3 py-3"
            : "rounded-xl bg-card p-4 shadow-(--shadow-border)",
        )}
      >
        <Ask approval={approval} agent={agent} session={session} />
        <Context {...props} linkSession={linkSession} linkItem={linkItem} />
      </div>
    );
  // Rows asking the same thing ("Run the migration" for three items) must
  // differ where people scan: the item leads the title, and the line under
  // it says the exact action and the session's task.
  const item = session.workItemId
    ? items.find((i) => i.id === session.workItemId)
    : undefined;
  const project = item
    ? projects.find((p) => p.id === item.projectId)
    : undefined;
  const itemKey = item && project ? identifier(project, item.number) : null;
  const action = approvalAction(approval.detail);
  const question = !asksPermission(approval.detail);
  const task = sessionTitle(session.title);
  const taskBesideKey =
    itemKey && task.startsWith(`${itemKey}: `)
      ? task.slice(itemKey.length + 2)
      : task;
  return (
    <li
      data-approval-request
      data-open={open || undefined}
      className="group/row [--actor-ring:var(--card)]"
    >
      <div className="flex min-h-12 items-center gap-3 px-3.5 py-2">
        <span className="shrink-0">
          {agent ? (
            <AgentAvatar agent={agent} size={20} />
          ) : question ? (
            <MessageCircleQuestion
              aria-hidden
              className="size-4 text-muted-foreground"
            />
          ) : (
            <ShieldQuestion aria-hidden className="size-4 text-warning" />
          )}
        </span>
        {/* The request's subject, which the row's button names. */}
        <span id={subjectId} className="min-w-0 flex-1">
          {/* On phones the key and the request read as one sentence of up
              to two lines, so a wrapped request starts its second line
              under the key, not in a column beside it (as in ListRow). */}
          <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] leading-5 max-sm:line-clamp-2 max-sm:break-words">
            {itemKey && (
              <span className="shrink-0 font-mono text-xs text-muted-foreground max-sm:mr-1.5">
                {itemKey}
              </span>
            )}
            <span className="min-w-0 font-medium sm:truncate">
              {approval.title}
            </span>
          </span>
          {/* What sets this request apart from its neighbours comes first:
              the exact action (or that it is a question), then the task it
              belongs to; the agent, usually the same on every row, last. */}
          <MetaLine className="mt-0.5">
            {/* The action is never cut: its arguments (--env staging or
                production) are what a person decides on. It wraps, and the
                task and agent follow it. */}
            {action && !question ? (
              <MetaPart>
                <ActionText action={action} />
              </MetaPart>
            ) : (
              <span className="shrink-0 font-medium text-foreground">
                Question
              </span>
            )}
            <span className="min-w-0 truncate text-foreground/80">
              {taskBesideKey}
            </span>
            <AgentActor
              agent={agent}
              ownerId={agent?.ownerId}
              avatar={false}
              className="shrink-0"
            />
          </MetaLine>
        </span>
        <Button
          variant={open ? "ghost" : "secondary"}
          size="sm"
          aria-expanded={open}
          aria-controls={bodyId}
          // Several rows can ask the same thing: the name says which.
          aria-label={`${open ? "Close" : question ? "Answer" : "Review"}: ${approval.title}, ${itemKey ?? `“${task}”`}`}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : question ? "Answer" : "Review"}
          <ChevronDown
            aria-hidden
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
        {/* The time is the last column, as in ListRow, so it lines up
            with the rows around it. */}
        <time
          dateTime={approval.createdAt}
          className="min-w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums max-sm:hidden"
        >
          {relativeTime(approval.createdAt)}
        </time>
      </div>
      {open && (
        <div id={bodyId} className="px-3.5 pb-3.5 pl-[46px]">
          <Context {...props} linkSession={linkSession} linkItem={linkItem} />
        </div>
      )}
    </li>
  );
}

// The exact action, in one line: "$ bun run db:migrate", "Write CHANGES.md".
function ActionText({
  action,
  className,
}: {
  action: ApprovalAction;
  className?: string;
}) {
  return (
    <code
      className={cn(
        "line-clamp-3 min-w-0 font-mono text-[11px] break-all whitespace-pre-wrap text-foreground",
        className,
      )}
    >
      {action.kind === "command"
        ? `$ ${action.text}`
        : action.kind === "file"
          ? `${action.tool} ${action.text}`
          : action.text}
    </code>
  );
}

// The question itself, for the full form.
function Ask({
  approval,
  agent,
  session,
}: {
  approval: ApprovalEntity;
  agent: AgentEntity | undefined;
  session: SessionEntity;
}) {
  const question = !asksPermission(approval.detail);
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          question
            ? "bg-primary/10 text-primary"
            : "bg-warning/10 text-warning",
        )}
      >
        {question ? (
          <MessageCircleQuestion className="size-4" aria-hidden />
        ) : (
          <ShieldQuestion className="size-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 font-semibold">{approval.title}</p>
        <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <AgentActor agent={agent} ownerId={agent?.ownerId} size={16} />
          <span aria-hidden>·</span>
          <span>asked {relativeTime(approval.createdAt)}</span>
          {session.attempts > 1 && <span>· attempt {session.attempts}</span>}
        </p>
      </div>
    </div>
  );
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

type Evidence = {
  reason: string;
  tool: string;
  input: unknown;
  command: { text: string; exit: number | null } | null;
  files: { path: string; kind: string }[];
  additions: number;
  deletions: number;
};

// What the session did up to the question: the request's own reason and
// input, the last command before it and the files it changed.
export function approvalEvidence(
  events: readonly SessionEventRow[],
  approval: Pick<ApprovalEntity, "id" | "requestKey" | "detail">,
): Evidence {
  // The request's own reason, tool and input are stored with it.
  const detail: Record<string, unknown> = approval.detail ?? {};
  const evidence: Evidence = {
    reason: str(detail.reason),
    tool: str(detail.tool),
    input: detail.input ?? undefined,
    command: null,
    files: [],
    additions: 0,
    deletions: 0,
  };
  const files = new Map<string, string>();
  for (const event of events) {
    const data = (event.data ?? {}) as Record<string, unknown>;
    if (event.type === "command")
      evidence.command = {
        text: str(data.command).split("\n")[0] ?? "",
        exit: typeof data.exitCode === "number" ? data.exitCode : null,
      };
    else if (event.type === "file_change" && Array.isArray(data.changes))
      for (const change of data.changes as {
        path?: string;
        kind?: string;
        additions?: number;
        deletions?: number;
      }[]) {
        if (!change.path) continue;
        files.set(change.path, change.kind ?? "modify");
        evidence.additions += change.additions ?? 0;
        evidence.deletions += change.deletions ?? 0;
      }
    else if (
      event.type === "approval_request" &&
      (str(data.approvalId) === approval.id ||
        str(data.requestId) === approval.requestKey)
    ) {
      evidence.reason ||= str(data.reason);
      evidence.tool ||= str(data.tool);
      evidence.input ??= data.input ?? undefined;
      break;
    }
  }
  evidence.files = [...files].map(([path, kind]) => ({ path, kind }));
  return evidence;
}

function Context({
  session,
  approval,
  agent,
  runner,
  linkSession,
  linkItem,
  onDecide,
}: Props & { linkSession: boolean; linkItem: boolean }) {
  const { organization, userId, items, projects, memberName } = useWorkspace();
  const org = organization.slug;
  const { events, complete } = useSessionEvents(session.id, 60);
  const evidence = useMemo(
    () => approvalEvidence(events, approval),
    [events, approval],
  );
  const claims = useLiveClaims();
  const item = session.workItemId
    ? items.find((i) => i.id === session.workItemId)
    : undefined;
  const project = item
    ? projects.find((p) => p.id === item.projectId)
    : undefined;
  const claim = item ? claims.get(item.id) : undefined;
  const dispatched =
    claim?.source === "dispatcher" && claim.agentSessionId === session.id;
  const decider = canDecide(session, agent, userId);
  const deciders = [
    ...new Set([agent?.ownerId, session.requestedById].filter(Boolean)),
  ] as string[];
  const input =
    evidence.input === undefined || evidence.input === null
      ? ""
      : typeof evidence.input === "string"
        ? evidence.input
        : JSON.stringify(evidence.input, null, 2);
  const reason = evidence.reason;
  const question = !asksPermission(approval.detail);
  const action = approvalAction({
    tool: evidence.tool,
    input: evidence.input,
  });
  // No repository is linked: what the agent writes is discarded when the
  // session ends. Said before the approval, not only after it.
  const unkept = !session.repositoryId && !session.repositoryUrl;
  return (
    <div className="mt-3 space-y-3 text-[13px]">
      {reason && <p className="leading-5">{reason}</p>}
      {unkept && action?.kind === "file" && (
        <p
          data-not-kept
          className="flex items-start gap-1.5 text-xs font-medium text-[color-mix(in_oklab,var(--warning)_70%,var(--foreground))]"
        >
          <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
          No repository is linked to this session: the file is written in a
          scratch workspace and discarded when the session ends.
        </p>
      )}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        {linkSession && (
          <Fact label="Session">
            <Link
              href={paths.factorySession(org, session.id)}
              className="truncate font-medium text-foreground underline-offset-2 focus-ring outline-none hover:underline"
            >
              {sessionTitle(session.title)}
            </Link>
          </Fact>
        )}
        {linkItem && item && project && (
          <Fact label="Work item">
            <Link
              href={paths.item(
                org,
                project.key,
                identifier(project, item.number),
              )}
              className="flex min-w-0 items-center gap-1.5 text-foreground underline-offset-2 focus-ring outline-none hover:underline"
            >
              <span className="shrink-0 font-mono text-muted-foreground">
                {identifier(project, item.number)}
              </span>
              <span className="truncate">{item.title}</span>
            </Link>
          </Fact>
        )}
        {/* A branch exists only in a repository. */}
        {session.branch && !unkept && (
          <Fact label="Branch" icon={<GitBranch />}>
            <span className="truncate font-mono">{session.branch}</span>
          </Fact>
        )}
        {runner && (
          <Fact label="Runner" icon={<Server />}>
            <span className="truncate">{runner.name}</span>
          </Fact>
        )}
        {dispatched && <DispatchedBy projectId={claim.projectId} />}
      </dl>
      {(evidence.tool || input) && (
        <div>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">
            {action?.kind === "command"
              ? "It wants to run"
              : action?.kind === "file"
                ? `It wants to use ${action.tool} on`
                : evidence.tool
                  ? `It wants to use ${evidence.tool}`
                  : "Its request"}
          </p>
          {action && action.kind !== "tool" ? (
            <>
              {/* Read after "It wants to run" above it; a name on a <pre>
                  (no role) would not be spoken. */}
              <pre className="max-h-40 overflow-auto rounded-lg bg-muted/60 p-2 font-mono text-[12px] leading-4 whitespace-pre-wrap text-foreground">
                {action.kind === "command" ? `$ ${action.text}` : action.text}
              </pre>
              {input && (
                <details className="mt-1 text-xs text-muted-foreground">
                  <summary className="cursor-pointer rounded-sm focus-ring outline-none">
                    The full request
                  </summary>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-lg bg-muted/60 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap">
                    {input}
                  </pre>
                </details>
              )}
            </>
          ) : (
            input && (
              <pre className="max-h-40 overflow-auto rounded-lg bg-muted/60 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap">
                {input}
              </pre>
            )
          )}
        </div>
      )}
      {(evidence.command !== null || evidence.files.length > 0) && (
        <div className="space-y-1.5 text-xs">
          {evidence.command && (
            <p className="flex min-w-0 items-center gap-1.5">
              <SquareTerminal
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="text-muted-foreground">Last command</span>
              <code className="min-w-0 truncate font-mono">
                $ {evidence.command.text}
              </code>
              {evidence.command.exit !== null && (
                <span
                  className={cn(
                    "shrink-0 tabular-nums",
                    evidence.command.exit === 0
                      ? "text-muted-foreground"
                      : "text-destructive",
                  )}
                >
                  exit {evidence.command.exit}
                </span>
              )}
            </p>
          )}
          {evidence.files.length > 0 && (
            <div className="flex min-w-0 items-start gap-1.5">
              <FileDiff
                aria-hidden
                className="mt-px size-3.5 shrink-0 text-muted-foreground"
              />
              <p className="min-w-0">
                <span className="text-muted-foreground">
                  {evidence.files.length === 1
                    ? "1 file changed"
                    : `${evidence.files.length} files changed`}
                  {(evidence.additions > 0 || evidence.deletions > 0) && (
                    <span className="tabular-nums">
                      {" "}
                      (+{evidence.additions} −{evidence.deletions})
                    </span>
                  )}
                  :{" "}
                </span>
                <span className="font-mono break-all">
                  {evidence.files
                    .slice(0, 3)
                    .map((f) => f.path)
                    .join(", ")}
                  {evidence.files.length > 3 &&
                    ` and ${evidence.files.length - 3} more`}
                </span>
              </p>
            </div>
          )}
        </div>
      )}
      {!complete && !reason && !input && (
        <p className="text-xs text-muted-foreground">Loading what it did…</p>
      )}
      {question && (
        <p className="text-[13px] leading-5">
          {agent?.name ?? "The agent"} asks this as a question: it names no
          command or file, so there is nothing to approve. Answer it in words,
          or deny it.
        </p>
      )}
      {(session.pullRequestId ?? session.pullRequestUrl) && (
        <p className="text-xs">
          {session.pullRequestId ? (
            <Link
              href={paths.codePullRequest(org, session.pullRequestId)}
              className="font-medium underline-offset-2 focus-ring outline-none hover:underline"
            >
              View the diff
            </Link>
          ) : (
            <a
              href={session.pullRequestUrl!}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline-offset-2 focus-ring outline-none hover:underline"
            >
              View the diff on the code host
            </a>
          )}
        </p>
      )}
      {decider ? (
        <Decide
          sessionId={session.id}
          approvalId={approval.id}
          question={question}
          agentName={agent?.name}
          subject={approval.title}
          onDecide={onDecide}
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          {deciders.length
            ? `${deciders.map((id) => firstName(memberName(id))).join(" or ")} decides: the agent’s owner or the person who started the session.`
            : "The agent’s owner or the person who started the session decides."}
        </p>
      )}
    </div>
  );
}

function DispatchedBy({ projectId }: { projectId: string }) {
  const { stored, policy } = useAutonomy(projectId);
  return (
    <Fact label="Started by">
      <PolicyActor
        level={policy.level}
        setById={stored?.updatedById}
        size={16}
      />
    </Fact>
  );
}

function Fact({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        {icon && (
          <span
            aria-hidden
            className="shrink-0 text-muted-foreground [&_svg]:size-3.5"
          >
            {icon}
          </span>
        )}
        {children}
      </dd>
    </>
  );
}

// Approve or Deny a permission, full-size; answer a question in words or
// deny it. The server decides who may answer, refuses to approve a request
// that names no action, and records the decision; the request leaves every
// list once it has. Several requests can be open at once (a thread, the
// Inbox), so each button's name says which one it answers: "Approve: Write
// CHANGES.md", starting with the word it shows.
export function Decide({
  sessionId,
  approvalId,
  question,
  agentName,
  subject,
  onDecide,
}: {
  sessionId: string;
  approvalId: string;
  question: boolean;
  agentName?: string;
  // The request's title.
  subject: string;
  onDecide?: (
    decision: "approve" | "deny" | "answer",
    note?: string,
  ) => Promise<void>;
}) {
  const { organization } = useWorkspace();
  const [sent, setSent] = useState<"approve" | "deny" | "answer" | null>(null);
  const [note, setNote] = useState("");
  const noteId = useId();
  const answer = async (decision: "approve" | "deny" | "answer") => {
    setSent(decision);
    try {
      if (onDecide) return await onDecide(decision, note.trim() || undefined);
      await callCapability("answerAgentApproval", {
        organizationId: organization.id,
        sessionId,
        approvalId,
        decision,
        note: decision === "approve" ? null : note.trim() || null,
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
  const status = sent && (
    <span role="status" className="text-xs text-muted-foreground">
      {sent === "approve" ? "Approved" : sent === "deny" ? "Denied" : "Sent"};
      telling the agent…
    </span>
  );
  if (question)
    return (
      <form
        className="space-y-2 pt-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (note.trim()) void answer("answer");
        }}
      >
        <label htmlFor={noteId} className="sr-only">
          Your answer to {agentName ?? "the agent"}
        </label>
        <Textarea
          id={noteId}
          value={note}
          onValueChange={setNote}
          maxLength={2000}
          rows={2}
          disabled={sent !== null}
          placeholder={`Answer ${agentName ?? "the agent"}…`}
          className="min-h-16 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20 touch:text-base"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            disabled={sent !== null || !note.trim()}
            aria-label={`Send answer: ${subject}`}
          >
            <Send className="size-3.5" aria-hidden /> Send answer
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => answer("deny")}
            disabled={sent !== null}
            aria-label={`Deny: ${subject}`}
          >
            <X className="size-3.5" aria-hidden /> Deny
          </Button>
          {status}
        </div>
      </form>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        onClick={() => answer("approve")}
        disabled={sent !== null}
        aria-label={`Approve: ${subject}`}
      >
        <Check className="size-3.5" aria-hidden /> Approve
      </Button>
      <Button
        variant="secondary"
        onClick={() => answer("deny")}
        disabled={sent !== null}
        aria-label={`Deny: ${subject}`}
      >
        <X className="size-3.5" aria-hidden /> Deny
      </Button>
      {status}
    </div>
  );
}
