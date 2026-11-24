import { memo, useState } from "react";
import {
  ArrowUpRight,
  CircleDot,
  Link2,
  Lightbulb,
  MessageSquareQuote,
  MessageSquareReply,
  MoreHorizontal,
  Pencil,
  SmilePlus,
  Sparkles,
  Trash2,
  EyeOff,
} from "lucide-react";
import { Toolbar, ToolbarButton } from "@ui-sdk/react/toolbar";
import { Button } from "@lictory/ui/button";
import { Tooltip } from "@lictory/ui/tooltip";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@lictory/ui/menu";
import { cn } from "@lictory/core/lib/utils";
import {
  AgentAvatar,
  Facepile,
  PersonAvatar,
  usePerson,
  type AgentIdentity,
  type Person,
} from "@lictory/platform/components/identity/actor";
import { firstName } from "@lictory/platform/lib/session-state";
import {
  formatTime,
  groupReactions,
  replyAuthors,
  shownReplyCount,
  type MessageRow,
} from "@lictory/platform/components/channels/data";
import { MessageMarkdown } from "@lictory/platform/components/channels/message-markdown";
import {
  FactoryCard,
  factoryCardOf,
} from "@lictory/platform/components/channels/factory-cards";
import {
  EmojiPicker,
  QUICK_REACTIONS,
} from "@lictory/platform/components/channels/emoji";
import {
  MarkdownEditor,
  type Mentionable,
} from "@lictory/platform/components/editor/markdown-editor";
import {
  FromSlack,
  SlackMark,
  SlackSendFailure,
} from "@lictory/platform/components/channels/slack";

// One message of a conversation, Slack-dense: avatar and name on the first
// of a group, hover (or focus) actions, reactions, the thread summary and
// promotion cards. Everything it changes goes through `actions`; it never
// decides what the server allows, only what to offer.

export type PromotionChoice = "proposal" | "decision" | "discussion";

export type MessageActions = {
  react: (message: MessageRow, emoji: string, add: boolean) => void;
  openThread?: (message: MessageRow) => void;
  edit: (message: MessageRow, body: string) => void;
  remove: (message: MessageRow) => void;
  promote: (message: MessageRow, kind: PromotionChoice) => void;
  copyLink: (message: MessageRow) => void;
  markUnread?: (message: MessageRow) => void;
  // Send again a message a linked Slack channel never received.
  retrySync?: (message: MessageRow) => void;
};

type Props = {
  message: MessageRow;
  grouped: boolean;
  userId: string;
  isAdmin: boolean;
  // People may post and react here (a member of an active channel).
  canPost: boolean;
  canReact: boolean;
  pending: boolean;
  highlighted: boolean;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  nameOf: (id: string | null | undefined) => string;
  // Agents by id (the Factory's directory); "Agent" when unknown.
  agentNameOf?: (id: string | null | undefined) => string;
  // The agent's identity (its emoji) for its avatar.
  agentOf?: (id: string | null | undefined) => AgentIdentity | undefined;
  mentions: Mentionable[];
  actions: MessageActions;
  // Thread view: replies have no thread summary and no "reply" action.
  inThread?: boolean;
  // Why a linked Slack channel never received this message.
  syncError?: string;
  // Replies its thread holds but does not show (requests a session card
  // shows): left out of the count.
  hiddenReplies?: number;
};

const iconButton =
  "grid size-7 place-items-center rounded-md text-muted-foreground focus-ring-inset outline-none hover:bg-muted hover:text-foreground touch:size-9";

export const ChannelMessage = memo(function ChannelMessage({
  message,
  grouped,
  userId,
  isAdmin,
  canPost,
  canReact,
  pending,
  highlighted,
  editing,
  onEditingChange,
  nameOf,
  agentNameOf = () => "Agent",
  agentOf = () => undefined,
  mentions,
  actions,
  inThread = false,
  syncError,
  hiddenReplies = 0,
}: Props) {
  const deleted = Boolean(message.deletedAt);
  const own = message.authorKind === "user" && message.authorUserId === userId;
  const external = Boolean(message.externalSource);
  const replies = shownReplyCount(message, hiddenReplies);
  // The Factory's cards speak for their agent ("Forge via Ada").
  const factory =
    message.kind === "card" ? factoryCardOf(message.payload) : undefined;
  const agentAuthor =
    message.authorKind === "agent"
      ? {
          id: message.authorAgentId ?? "agent",
          name: agentNameOf(message.authorAgentId),
          avatar: agentOf(message.authorAgentId)?.avatar,
          ownerId: message.onBehalfOfUserId,
        }
      : factory
        ? {
            id: "agentId" in factory ? factory.agentId : factory.agentName,
            name: factory.agentName,
            avatar:
              "agentId" in factory ? agentOf(factory.agentId)?.avatar : null,
            ownerId: factory.ownerId,
          }
        : undefined;
  const author = agentAuthor?.name ?? authorName(message, nameOf);
  const member = usePerson(message.authorUserId);
  // Someone in a linked Slack channel without a Lictory identity wears the
  // Slack mark; a person seen through Slack is still themselves.
  const person: Person =
    message.authorKind === "external"
      ? {
          id: `slack:${message.externalAuthorName ?? "someone"}`,
          name: message.externalAuthorName ?? "Someone",
          external: "slack",
        }
      : message.authorKind === "system"
        ? { id: "lictory", name: "Lictory" }
        : member;
  const time = formatTime(message.createdAt);
  const reactions = groupReactions(
    message.reactions,
    userId,
    message.externalReactions,
  );
  const isRoot = !message.threadRootId;
  const system = message.kind === "system";
  // Phones have no hover: a tap on the message shows its actions.
  const [touched, setTouched] = useState(false);
  if (system)
    return (
      <div
        id={`message-${message.id}`}
        data-message-id={message.id}
        className="flex items-baseline gap-2 py-1 pr-4 pl-[3.75rem] text-[13px] text-muted-foreground"
      >
        <span>
          <span className="font-medium text-foreground">
            {nameOf(message.authorUserId)}
          </span>{" "}
          <MessageMarkdown
            source={message.body}
            userId={userId}
            className="inline [&>p]:inline"
          />
        </span>
        <time
          className="shrink-0 text-xs tabular-nums"
          dateTime={new Date(message.createdAt).toISOString()}
        >
          {time}
        </time>
      </div>
    );
  return (
    <div
      id={`message-${message.id}`}
      data-message-id={message.id}
      data-pending={pending || undefined}
      data-touched={touched || undefined}
      onPointerUp={(e) => {
        if (e.pointerType !== "touch") return;
        if (
          (e.target as HTMLElement).closest(
            "a, button, input, [contenteditable]",
          )
        )
          return;
        setTouched((t) => !t);
      }}
      className={cn(
        "group/message relative flex gap-2.5 pr-4 pl-4 transition-colors",
        grouped ? "py-0.5" : "pt-2 pb-0.5",
        highlighted
          ? "bg-amber-400/10"
          : "focus-within:bg-muted/40 hover:bg-muted/40",
        pending && "opacity-70",
      )}
    >
      <div className="w-9 shrink-0">
        {grouped ? (
          <time
            className="mt-0.5 block text-right text-[11px] leading-6 text-muted-foreground tabular-nums opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100"
            dateTime={new Date(message.createdAt).toISOString()}
          >
            {time}
          </time>
        ) : agentAuthor ? (
          <AgentAvatar agent={agentAuthor} size={36} className="mt-0.5" />
        ) : (
          <PersonAvatar person={person} size={36} className="mt-0.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-[14px] font-semibold">{author}</span>
            {agentAuthor?.ownerId && (
              <Tooltip label={`Acts for ${nameOf(agentAuthor.ownerId)}`}>
                <span className="text-xs text-muted-foreground">
                  via {firstName(nameOf(agentAuthor.ownerId))}
                </span>
              </Tooltip>
            )}
            {message.via && (
              <span
                className="text-xs text-muted-foreground"
                title="Sent by an agent acting for this person"
              >
                via {message.via}
              </span>
            )}
            <time
              className="text-xs text-muted-foreground tabular-nums"
              dateTime={new Date(message.createdAt).toISOString()}
              title={new Date(message.createdAt).toLocaleString()}
            >
              {time}
            </time>
            {external &&
              (message.externalSource === "slack" ? (
                <FromSlack />
              ) : (
                <span className="text-xs text-muted-foreground">
                  from {message.externalSource}
                </span>
              ))}
          </div>
        )}
        {deleted ? (
          <p className="text-[14px] text-muted-foreground italic">
            This message was deleted.
          </p>
        ) : editing ? (
          <EditMessage
            message={message}
            mentions={mentions}
            onCancel={() => onEditingChange(false)}
            onSave={(body) => {
              actions.edit(message, body);
              onEditingChange(false);
            }}
          />
        ) : message.kind === "card" ? (
          factory ? (
            <FactoryCard payload={factory} detailed={inThread} root={isRoot} />
          ) : (
            <PromotionCard message={message} userId={userId} />
          )
        ) : (
          <>
            {message.body && (
              <MessageMarkdown source={message.body} userId={userId} />
            )}
            {message.attachments.length > 0 && (
              <Attachments message={message} />
            )}
            {(message.externalFiles?.length ?? 0) > 0 && (
              <ExternalFiles message={message} />
            )}
            {message.editedAt && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}
          </>
        )}
        {reactions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {reactions.map((r) => (
              <Tooltip
                key={r.emoji}
                label={`${[...r.userIds.map((id) => nameOf(id)), ...r.names].join(", ")} reacted with ${r.emoji}`}
              >
                <button
                  type="button"
                  aria-pressed={r.mine}
                  disabled={!canReact || deleted}
                  onClick={() => actions.react(message, r.emoji, !r.mine)}
                  className={cn(
                    "inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs tabular-nums focus-ring outline-none touch:h-8",
                    r.mine
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "bg-card hover:bg-muted",
                  )}
                >
                  <span aria-hidden>{r.emoji}</span>
                  {r.count}
                </button>
              </Tooltip>
            ))}
          </div>
        )}
        {syncError && !deleted && (
          <SlackSendFailure
            error={syncError}
            onRetry={
              actions.retrySync ? () => actions.retrySync?.(message) : undefined
            }
          />
        )}
        {isRoot && !inThread && replies > 0 && actions.openThread && (
          <button
            type="button"
            onClick={() => actions.openThread?.(message)}
            className="mt-1 -ml-1 flex min-h-7 items-center gap-2 rounded-md px-1 py-0.5 text-[13px] focus-ring outline-none hover:bg-card"
          >
            <Facepile
              people={replyAuthors(message).map((author) =>
                author.kind === "agent"
                  ? {
                      id: author.id,
                      name: agentNameOf(author.id),
                      avatar: agentOf(author.id)?.avatar,
                      agent: true as const,
                    }
                  : { id: author.id, name: nameOf(author.id) },
              )}
              max={4}
              size={20}
              label="Replied"
            />
            <span className="font-medium text-primary">
              {replies} {replies === 1 ? "reply" : "replies"}
            </span>
            {message.lastReplyAt && (
              <span className="text-muted-foreground">
                Last reply {formatTime(message.lastReplyAt)}
              </span>
            )}
          </button>
        )}
      </div>
      {!deleted && !editing && (
        // One tab stop per message; arrow keys move between its actions.
        // Shown on hover and focus, and while one of its menus is open.
        <Toolbar
          aria-label="Message actions"
          className="pointer-events-none absolute top-0 right-3 z-10 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 opacity-0 shadow-(--shadow-panel) group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-data-touched/message:pointer-events-auto group-data-touched/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-[[data-open]]:pointer-events-auto has-[[data-open]]:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100"
        >
          {canReact &&
            QUICK_REACTIONS.slice(0, 3).map((emoji) => (
              <ToolbarButton
                key={emoji}
                aria-label={`React with ${emoji}`}
                className={iconButton}
                onClick={() => actions.react(message, emoji, true)}
              >
                <span aria-hidden className="text-[15px]">
                  {emoji}
                </span>
              </ToolbarButton>
            ))}
          {canReact && (
            <EmojiPicker
              onPick={(emoji) => actions.react(message, emoji, true)}
              trigger={(props) => (
                <ToolbarButton
                  {...props}
                  aria-label="Add reaction"
                  className={iconButton}
                >
                  <SmilePlus className="size-4" aria-hidden />
                </ToolbarButton>
              )}
            />
          )}
          {isRoot && !inThread && actions.openThread && (
            <ToolbarButton
              aria-label="Reply in thread"
              title="Reply in thread"
              className={iconButton}
              onClick={() => actions.openThread?.(message)}
            >
              <MessageSquareReply className="size-4" aria-hidden />
            </ToolbarButton>
          )}
          <Menu>
            <MenuTrigger
              render={
                <ToolbarButton
                  aria-label="More actions"
                  className={iconButton}
                />
              }
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </MenuTrigger>
            <MenuContent align="end" width={232}>
              {message.kind === "message" && (
                <>
                  <MenuItem
                    onSelect={() => actions.promote(message, "proposal")}
                  >
                    <Lightbulb className="size-3.5 text-muted-foreground" />{" "}
                    Promote to proposal
                  </MenuItem>
                  <MenuItem
                    onSelect={() => actions.promote(message, "decision")}
                  >
                    <CircleDot className="size-3.5 text-muted-foreground" />{" "}
                    Record as decision
                  </MenuItem>
                  <MenuItem
                    onSelect={() => actions.promote(message, "discussion")}
                  >
                    <MessageSquareQuote className="size-3.5 text-muted-foreground" />{" "}
                    Discuss on a specification
                  </MenuItem>
                  <MenuSeparator />
                </>
              )}
              <MenuItem onSelect={() => actions.copyLink(message)}>
                <Link2 className="size-3.5 text-muted-foreground" /> Copy link
              </MenuItem>
              {actions.markUnread && (
                <MenuItem onSelect={() => actions.markUnread?.(message)}>
                  <EyeOff className="size-3.5 text-muted-foreground" /> Mark
                  unread
                </MenuItem>
              )}
              {own && canPost && !external && message.kind === "message" && (
                <MenuItem onSelect={() => onEditingChange(true)}>
                  <Pencil className="size-3.5 text-muted-foreground" /> Edit
                  message
                </MenuItem>
              )}
              {(own || isAdmin) && !external && message.kind === "message" && (
                <MenuItem onSelect={() => actions.remove(message)}>
                  <Trash2 className="size-3.5 text-destructive" /> Delete
                  message
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </Toolbar>
      )}
    </div>
  );
});

function authorName(
  message: MessageRow,
  nameOf: (id: string | null | undefined) => string,
) {
  if (message.authorKind === "agent") return "Agent";
  if (message.authorKind === "system") return "Lictory";
  // Someone in a linked Slack channel with no Lictory identity.
  if (message.authorKind === "external")
    return `${message.externalAuthorName ?? "Someone"} (Slack)`;
  return nameOf(message.authorUserId);
}

// Files shared in Slack: a link to them there (Slack checks access).
function ExternalFiles({ message }: { message: MessageRow }) {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {(message.externalFiles ?? []).map((file) => (
        <a
          key={file.url}
          href={file.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex max-w-64 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] hover:bg-muted"
        >
          <SlackMark className="text-muted-foreground" />
          <span className="truncate">{file.name}</span>
          {file.size > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {Math.max(1, Math.round(file.size / 1024))} KB
            </span>
          )}
          <ArrowUpRight
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </a>
      ))}
    </div>
  );
}

function Attachments({ message }: { message: MessageRow }) {
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {message.attachments.map((file) =>
        file.mimeType.startsWith("image/") ? (
          <a
            key={file.id}
            href={`/api/files/${file.id}`}
            target="_blank"
            rel="noreferrer noopener"
            className="block"
          >
            <img
              src={`/api/files/${file.id}`}
              alt={file.filename}
              loading="lazy"
              className="max-h-64 max-w-full rounded-lg object-contain shadow-[0_0_0_1px_oklch(0_0_0/0.1)] sm:max-w-sm"
            />
          </a>
        ) : (
          <a
            key={file.id}
            href={`/api/files/${file.id}?download=1`}
            className="flex max-w-64 items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-[13px] hover:bg-muted"
          >
            <ArrowUpRight
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="truncate">{file.filename}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {Math.max(1, Math.round(file.size / 1024))} KB
            </span>
          </a>
        ),
      )}
    </div>
  );
}

// What a message became: the card links the proposal, decision or
// discussion, rendered live by the reference chips.
function PromotionCard({
  message,
  userId,
}: {
  message: MessageRow;
  userId: string;
}) {
  const kind = message.payload?.promotion;
  return (
    <div className="mt-0.5 flex max-w-xl items-start gap-2 rounded-lg border bg-card px-3 py-2">
      <Sparkles className="mt-1 size-3.5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 text-[13px]">
        <p className="text-xs font-semibold text-muted-foreground">
          {kind === "decision"
            ? "Decision recorded"
            : kind === "discussion"
              ? "Discussion opened"
              : "Proposal created"}
        </p>
        <MessageMarkdown source={message.body} userId={userId} />
      </div>
    </div>
  );
}

function EditMessage({
  message,
  mentions,
  onCancel,
  onSave,
}: {
  message: MessageRow;
  mentions: Mentionable[];
  onCancel: () => void;
  onSave: (body: string) => void;
}) {
  const [body, setBody] = useState(message.body);
  const save = () => {
    if (!body.trim() && !message.attachments.length) return;
    if (body === message.body) onCancel();
    else onSave(body);
  };
  return (
    <div className="mt-1 rounded-lg border bg-card">
      <MarkdownEditor
        value={body}
        onValueChange={setBody}
        mentions={mentions}
        onSubmit={save}
        onEscape={onCancel}
        enterSubmits
        autoFocus
        compact
        toolbar={false}
        minHeight="1.5rem"
        maxHeight="16rem"
        aria-label="Edit message"
        containerClassName="rounded-none border-0 bg-transparent ring-0 focus-within:ring-0"
      />
      <div className="flex items-center justify-end gap-2 border-t px-2 py-1.5 text-xs text-muted-foreground">
        <span className="mr-auto">Enter to save · Escape to cancel</span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
