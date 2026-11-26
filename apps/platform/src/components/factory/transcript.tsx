import { memo, type ReactNode } from "react";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  CircleSlash,
  Dot,
  FileMinus,
  FilePen,
  FilePlus,
  Info,
  Pause,
  Play,
  ShieldQuestion,
  Sparkles,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import type {
  AgentEntity,
  SessionEntity,
  SessionEventRow,
} from "@lictory/core/factory/entities";
import { cn } from "@lictory/core/lib/utils";
import { StatusChip } from "@lictory/ui/status-chip";
import { Markdown } from "@lictory/platform/components/items/markdown";
import {
  AgentAvatar,
  PersonAvatar,
} from "@lictory/platform/components/identity/actor";

// A session's event log rendered like a coding agent's transcript: people's
// messages and the agent's answers in full, tool calls and commands folded
// to one line each, file changes as a list, requests and status as quiet
// lines. Every row sits on one grid: 8px steps, a 24px icon column, then
// the text.

type Data = Record<string, unknown>;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : null);

export type TranscriptItem =
  | { kind: "event"; event: SessionEventRow }
  // A tool call with its result, paired by call id.
  | { kind: "tool"; call: SessionEventRow; result: SessionEventRow | null };

// Pairs tool calls with their results; everything else stays in order.
export function transcriptItems(events: readonly SessionEventRow[]) {
  const results = new Map<string, SessionEventRow>();
  for (const event of events)
    if (event.type === "tool_result") {
      const id = str((event.data as Data).callId);
      if (id) results.set(id, event);
    }
  const paired = new Set<string>();
  const items: TranscriptItem[] = [];
  // A failed run reports its error, then the status that ends it with the
  // same words: the error is shown once.
  const errors = new Set<string>();
  for (const event of events) {
    const message = str((event.data as Data).message).trim();
    if (event.type === "error" && message) errors.add(message);
    if (event.type === "status" && message && errors.has(message)) continue;
    if (event.type === "tool_call") {
      const id = str((event.data as Data).callId);
      const result = results.get(id) ?? null;
      if (result) paired.add(id);
      items.push({ kind: "tool", call: event, result });
    } else if (event.type === "tool_result") {
      if (!paired.has(str((event.data as Data).callId)))
        items.push({ kind: "event", event });
    } else items.push({ kind: "event", event });
  }
  return items;
}

export const TranscriptRow = memo(function TranscriptRow({
  item,
  session,
  agent,
  memberName,
}: {
  item: TranscriptItem;
  session: SessionEntity;
  agent: AgentEntity | undefined;
  memberName: (id: string | null | undefined) => string;
}) {
  if (item.kind === "tool")
    return <ToolRow call={item.call} result={item.result} />;
  const { event } = item;
  const data = event.data as Data;
  switch (event.type) {
    case "user_message": {
      const name = str(data.authorName) || memberName(str(data.authorId));
      return (
        <div className="flex justify-end gap-2 py-1">
          <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-muted px-3.5 py-2">
            <div className="mb-0.5 text-xs font-medium text-muted-foreground">
              {name}
              {str(data.viaAgent) && ` via ${str(data.viaAgent)}`}
            </div>
            <div className="text-[13px] leading-6 whitespace-pre-wrap">
              {str(data.text)}
            </div>
          </div>
          <PersonAvatar
            person={{ id: str(data.authorId) || name, name }}
            size={24}
            className="mt-1"
          />
        </div>
      );
    }
    case "context":
      // What Lictory told the agent besides a person's words: where it was
      // asked and the quoted conversation, or a policy's task. Lictory's
      // text, never shown as anyone's message.
      return (
        <Fold
          icon={<Info />}
          title={`Context ${agent?.name ?? "the agent"} received`}
          sans
          detail={
            str(data.summary) ? (
              <span className="hidden min-w-0 truncate text-muted-foreground sm:block">
                {str(data.summary)}
              </span>
            ) : undefined
          }
        >
          {str(data.summary) && (
            <p className="mb-1.5 text-xs text-muted-foreground sm:hidden">
              {str(data.summary)}
            </p>
          )}
          <p className="rounded-lg bg-muted/60 p-2.5 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {str(data.text)}
          </p>
        </Fold>
      );
    case "message":
      return (
        <div className="flex gap-2 py-1">
          <span className="grid w-6 shrink-0 justify-items-center pt-0.5">
            {agent ? (
              <AgentAvatar agent={agent} size={20} />
            ) : (
              <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            )}
          </span>
          <div className="min-w-0 flex-1 text-[13px] leading-6">
            <Markdown source={str(data.text)} answer />
          </div>
        </div>
      );
    case "reasoning":
      return (
        <Fold icon={<Brain />} title="Thinking" sans>
          <p className="text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
            {str(data.text)}
          </p>
        </Fold>
      );
    case "command":
      return <CommandRow data={data} />;
    case "file_change":
      return <FileChanges data={data} />;
    case "approval_request": {
      // The request is answered in the banner above the composer; here it
      // stays as a record of what was asked.
      const pending = session.approvals.some(
        (a) =>
          a.id === str(data.approvalId) || a.requestKey === str(data.requestId),
      );
      return (
        <Line icon={<ShieldQuestion className="text-warning" />}>
          <span className="text-foreground">
            {agent?.name ?? "The agent"} asked to approve{" "}
            <span className="font-medium">{str(data.title)}</span>
          </span>
          {str(data.reason) && (
            <span className="block text-muted-foreground">
              {str(data.reason)}
            </span>
          )}
          {pending && session.status === "waiting" && (
            <span className="block text-muted-foreground">
              Waiting for an answer below.
            </span>
          )}
        </Line>
      );
    }
    case "approval_answer":
      return (
        <Line
          icon={
            data.decision === "approve" ? (
              <Check className="text-success" />
            ) : (
              <X className="text-destructive" />
            )
          }
        >
          <span className="font-medium text-foreground">
            {str(data.byName)}
          </span>{" "}
          {data.decision === "approve" ? "approved" : "denied"} “
          {str(data.title)}”{str(data.note) && `: ${str(data.note)}`}
        </Line>
      );
    case "status": {
      if (!str(data.message)) return null;
      // A person's own act (started, interrupted, canceled, retried) is a
      // decision in the conversation, not log noise: it reads at message
      // weight with an icon that says what happened.
      const steering = typeof data.byId === "string";
      return (
        <Line
          emphasis={steering}
          icon={
            !steering ? (
              <Dot />
            ) : data.phase === "canceled" ? (
              <CircleSlash className="text-foreground" />
            ) : data.phase === "interrupt_requested" ? (
              <Pause className="text-foreground" />
            ) : (
              <Play className="text-foreground" />
            )
          }
        >
          {str(data.message)}
        </Line>
      );
    }
    case "error":
      return (
        <div className="flex gap-2 rounded-lg bg-destructive/8 px-2 py-2 text-[13px] ring-1 ring-destructive/20">
          <span className="grid w-6 shrink-0 justify-items-center pt-0.5">
            <AlertTriangle className="size-3.5 text-destructive" aria-hidden />
          </span>
          <p className="min-w-0 whitespace-pre-wrap">{str(data.message)}</p>
        </div>
      );
    case "summary":
      return (
        <div className="rounded-xl bg-card px-4 py-3 shadow-(--shadow-border)">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Sparkles className="size-3.5" aria-hidden /> Summary from the agent
          </div>
          <div className="text-[13px] leading-6">
            <Markdown source={str(data.text)} answer />
          </div>
        </div>
      );
    case "tool_result":
      return <ToolRow call={null} result={event} />;
    default:
      return null;
  }
});

// A quiet line of the log in the same columns as every row: a 24px icon
// column, then the text.
function Line({
  icon,
  emphasis = false,
  children,
}: {
  icon: ReactNode;
  // A person's decision: full text color and size.
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-8 items-start gap-2 py-1.5 leading-5",
        emphasis
          ? "text-[13px] font-medium text-foreground"
          : "text-xs text-muted-foreground",
      )}
    >
      <span
        aria-hidden
        className="grid h-5 w-6 shrink-0 place-items-center [&_svg]:size-3.5"
      >
        {icon}
      </span>
      <p className="min-w-0 flex-1">{children}</p>
    </div>
  );
}

function Fold({
  icon,
  title,
  detail,
  tone,
  sans = false,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  tone?: "danger";
  // Lictory's words (context, thinking) rather than a command or a tool.
  sans?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        className={cn(
          "group flex h-8 w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left text-xs focus-ring-inset outline-none hover:bg-muted/60",
          tone === "danger" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <span
          aria-hidden
          className="grid w-6 shrink-0 place-items-center [&_svg]:size-3.5"
        >
          {icon}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            sans
              ? "text-[13px] text-muted-foreground"
              : "font-mono text-[12px] text-foreground/85",
          )}
        >
          {title}
        </span>
        {detail}
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-150 group-data-open:rotate-90 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="mt-1 mb-2 ml-8">{children}</CollapsiblePanel>
    </Collapsible>
  );
}

const Output = ({ text }: { text: string }) =>
  text ? (
    <pre className="max-h-80 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-4 whitespace-pre-wrap">
      {text}
    </pre>
  ) : (
    <p className="text-xs text-muted-foreground">No output.</p>
  );

function ToolRow({
  call,
  result,
}: {
  call: SessionEventRow | null;
  result: SessionEventRow | null;
}) {
  const c = (call?.data ?? {}) as Data;
  const r = (result?.data ?? {}) as Data;
  const failed = r.isError === true;
  const title = str(c.summary) || str(c.name) || "Tool result";
  return (
    <Fold
      icon={<Wrench />}
      title={title}
      tone={failed ? "danger" : undefined}
      detail={
        !result ? (
          <span className="shrink-0 text-xs">running…</span>
        ) : failed ? (
          <StatusChip tone="danger">Failed</StatusChip>
        ) : null
      }
    >
      {c.input !== undefined && (
        <pre className="mb-1.5 max-h-48 overflow-auto rounded-lg bg-muted/60 p-2.5 font-mono text-[11px] leading-4">
          {JSON.stringify(c.input, null, 2)}
        </pre>
      )}
      {result && <Output text={str(r.output)} />}
    </Fold>
  );
}

function CommandRow({ data }: { data: Data }) {
  const exit = num(data.exitCode);
  const duration = num(data.durationMs);
  return (
    <Fold
      icon={<SquareTerminal />}
      title={`$ ${str(data.command).split("\n")[0]}`}
      tone={exit !== null && exit !== 0 ? "danger" : undefined}
      detail={
        <span className="shrink-0 text-xs tabular-nums">
          {exit === null ? "" : exit === 0 ? "exit 0" : `exit ${exit}`}
          {duration !== null && ` · ${(duration / 1000).toFixed(1)} s`}
        </span>
      }
    >
      <Output text={str(data.output)} />
    </Fold>
  );
}

const fileIcons = {
  add: FilePlus,
  modify: FilePen,
  delete: FileMinus,
  rename: FilePen,
} as const;

function FileChanges({ data }: { data: Data }) {
  const changes = Array.isArray(data.changes)
    ? (data.changes as { path?: string; kind?: keyof typeof fileIcons }[])
    : [];
  if (!changes.length) return null;
  return (
    <ul
      aria-label="Files changed"
      className="ml-8 rounded-lg bg-card py-1 shadow-(--shadow-border)"
    >
      {changes.map((change, index) => {
        const Icon = fileIcons[change.kind ?? "modify"] ?? FilePen;
        return (
          <li
            key={`${change.path}-${index}`}
            className="flex h-7 items-center gap-2 px-2.5 text-xs"
          >
            <Icon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0",
                change.kind === "add" && "text-success",
                change.kind === "delete" && "text-destructive",
                (change.kind === "modify" || change.kind === "rename") &&
                  "text-muted-foreground",
              )}
            />
            <span className="sr-only">{change.kind}</span>
            <span className="min-w-0 truncate font-mono text-[12px]">
              {change.path}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
