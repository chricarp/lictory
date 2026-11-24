import { memo, type ReactNode } from "react";
import {
  AlertTriangle,
  Brain,
  ChevronRight,
  FileMinus,
  FilePen,
  FilePlus,
  ShieldQuestion,
  Sparkles,
  SquareTerminal,
  Wrench,
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
import { Avatar, Badge } from "@lictory/ui/primitives";
import { Markdown } from "@lictory/platform/components/items/markdown";
import {
  AgentMark,
  ApprovalActions,
} from "@lictory/platform/components/factory/parts";

// A session's event log rendered like a coding agent's transcript: people's
// messages and the agent's answers in full, tool calls and commands folded
// to one line each, file changes as a list, questions as cards.

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
  for (const event of events) {
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
  canAnswer,
}: {
  item: TranscriptItem;
  session: SessionEntity;
  agent: AgentEntity | undefined;
  memberName: (id: string | null | undefined) => string;
  canAnswer: boolean;
}) {
  if (item.kind === "tool")
    return <ToolRow call={item.call} result={item.result} />;
  const { event } = item;
  const data = event.data as Data;
  switch (event.type) {
    case "user_message":
      return (
        <div className="flex justify-end gap-2">
          <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-muted px-3.5 py-2">
            <div className="mb-0.5 text-[11px] font-medium text-muted-foreground">
              {str(data.authorName) || memberName(str(data.authorId))}
              {str(data.viaAgent) && ` via ${str(data.viaAgent)}`}
            </div>
            <div className="text-[13px] leading-6 whitespace-pre-wrap">
              {str(data.text)}
            </div>
          </div>
          <Avatar
            userId={str(data.authorId)}
            name={str(data.authorName)}
            size="xs"
            className="mt-1"
          />
        </div>
      );
    case "message":
      return (
        <div className="flex gap-2.5">
          <AgentMark agent={agent} className="mt-0.5" />
          <div className="min-w-0 flex-1 text-[13px] leading-6">
            <Markdown source={str(data.text)} answer />
          </div>
        </div>
      );
    case "reasoning":
      return (
        <Fold
          icon={<Brain className="size-3.5" />}
          title="Thinking"
          tone="muted"
        >
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
      const pending = session.approvals.find(
        (a) =>
          a.id === str(data.approvalId) || a.requestKey === str(data.requestId),
      );
      return (
        <div
          className={cn(
            "rounded-xl px-4 py-3 shadow-(--shadow-border)",
            pending ? "bg-warning/8 ring-1 ring-warning/25" : "bg-card",
          )}
        >
          <div className="flex items-start gap-2.5">
            <ShieldQuestion
              className="mt-0.5 size-4 shrink-0 text-warning"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{str(data.title)}</div>
              {str(data.reason) && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {str(data.reason)}
                </p>
              )}
              {data.input !== undefined && data.input !== null && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-muted/60 p-2 font-mono text-[11px] leading-4">
                  {JSON.stringify(data.input, null, 2)}
                </pre>
              )}
              {pending && (
                <div className="mt-3">
                  <ApprovalActions
                    session={session}
                    approval={pending}
                    canAnswer={canAnswer}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    case "approval_answer":
      return (
        <p className="text-center text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {str(data.byName)}
          </span>{" "}
          {data.decision === "approve" ? "approved" : "denied"} “
          {str(data.title)}”{str(data.note) && `: ${str(data.note)}`}
        </p>
      );
    case "status":
      return str(data.message) ? (
        <p className="text-center text-xs text-muted-foreground">
          {str(data.message)}
        </p>
      ) : null;
    case "error":
      return (
        <div className="flex gap-2 rounded-lg bg-destructive/8 px-3 py-2 text-[13px] ring-1 ring-destructive/20">
          <AlertTriangle
            className="mt-0.5 size-3.5 shrink-0 text-destructive"
            aria-hidden
          />
          <p className="min-w-0 whitespace-pre-wrap">{str(data.message)}</p>
        </div>
      );
    case "summary":
      return (
        <div className="rounded-xl bg-card px-4 py-3 shadow-(--shadow-border)">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
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

function Fold({
  icon,
  title,
  detail,
  tone,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  tone?: "muted" | "danger";
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60",
          tone === "danger" ? "text-destructive" : "text-muted-foreground",
        )}
      >
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform duration-150 group-data-open:rotate-90"
        />
        <span className="shrink-0" aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/80">
          {title}
        </span>
        {detail}
      </CollapsibleTrigger>
      <CollapsiblePanel className="mt-1 ml-6">{children}</CollapsiblePanel>
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
      icon={<Wrench className="size-3.5" />}
      title={title}
      tone={failed ? "danger" : undefined}
      detail={
        !result ? (
          <span className="shrink-0 text-[11px]">running…</span>
        ) : failed ? (
          <Badge tone="danger">failed</Badge>
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
      icon={<SquareTerminal className="size-3.5" />}
      title={`$ ${str(data.command).split("\n")[0]}`}
      tone={exit !== null && exit !== 0 ? "danger" : undefined}
      detail={
        <span className="shrink-0 text-[11px] tabular-nums">
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
    <ul className="space-y-0.5 rounded-lg bg-card px-2.5 py-1.5 shadow-(--shadow-border)">
      {changes.map((change, index) => {
        const Icon = fileIcons[change.kind ?? "modify"] ?? FilePen;
        return (
          <li
            key={`${change.path}-${index}`}
            className="flex items-center gap-2 text-xs"
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
