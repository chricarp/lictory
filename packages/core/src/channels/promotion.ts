import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { typeLevels } from "@lictory/core/lib/work-items";
import { PROTOCOL, type Command } from "@lictory/core/contracts/protocol";
import { formatReference } from "@lictory/core/contracts/references";
import { DomainError } from "@lictory/core/domain/errors";
import {
  applyMutation,
  authorize,
  isAdmin,
  lock,
  type Actor,
  type Database,
  type MutationOutcome,
  type Tx,
} from "@lictory/core/domain/service";
import { paths } from "@lictory/core/lib/paths";
import { readChannelAccess } from "@lictory/core/channels/access";
import { appendSystemMessage } from "@lictory/core/channels/writer";
import type { ChannelPromotionKind } from "@lictory/core/channels/shared";

// Promotion (docs/internals/channels.md#promotion): what matters in a
// conversation becomes a durable object instead of scrollback. Each kind is
// the existing workspace command (createWorkItem, recordDecision,
// createThread) with its own authorization, projections, notifications and
// receipt, run by `applyMutation` in this transaction; then the promotion
// link and a card in the message's thread are written in the same
// transaction. So either the object, the link and the card all exist, or
// none does. Retrying with the same `mutationId` returns the first result.
//
// The object quotes the message and links back to it; the card links to the
// object; `channel_promotion` lets the object's page find the conversation
// (only for people who can read the channel).

type Source = {
  organizationId: string;
  channelId: string;
  messageId: string;
  // Quote the whole thread (the message's root and its replies).
  includeThread?: boolean;
  mutationId?: string;
};

type PromotionTarget =
  | {
      kind: "proposal";
      projectId: string;
      // A specification-backed type of the project; defaults to the first
      // enabled one at the Story level, else the lowest one.
      typeId?: string;
      title: string;
      teamId?: string | null;
    }
  | {
      kind: "decision";
      workItemId: string;
      title: string;
      // What was decided, in the promoter's words; the message is quoted
      // after it.
      body?: string;
    }
  | {
      kind: "discussion";
      workItemId: string;
      // Heading the discussion is anchored to ("" for the whole text).
      section: string;
      quote?: string;
      occurrence?: number;
      blocking: boolean;
      note?: string;
    };

type PromotionResult = {
  promotionId: string;
  kind: ChannelPromotionKind;
  workItemId: string;
  decisionId: string | null;
  threadId: string | null;
  cardMessageId: string | null;
  mutationId: string;
  replayed: boolean;
};

const QUOTED_REPLIES = 20;

export async function promoteMessage(
  db: Database,
  actor: Actor,
  source: Source,
  target: PromotionTarget,
  effects: { applied?(outcome: MutationOutcome): void } = {},
): Promise<PromotionResult> {
  const mutationId = source.mutationId ?? crypto.randomUUID();
  return db.transaction(async (tx) => {
    // Exclusive organization lock first, as every command; the card is
    // appended afterwards under the channel lock (same order as the
    // conversation writer).
    await lock(tx, source.organizationId);
    const previous = await existingPromotion(
      tx,
      source.organizationId,
      mutationId,
    );
    if (previous) return { ...previous, replayed: true };
    const membership = await authorize(tx, actor.userId, source.organizationId);
    const access = await readChannelAccess(
      tx,
      source.organizationId,
      actor.userId,
      source.channelId,
      isAdmin(membership),
    );
    const [message] = await tx
      .select()
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.organizationId, source.organizationId),
          eq(s.channelMessage.channelId, source.channelId),
          eq(s.channelMessage.id, source.messageId),
        ),
      );
    if (!message)
      throw new DomainError("not_found", "This message is unavailable.");
    if (message.deletedAt || message.kind !== "message")
      throw new DomainError(
        "validation",
        "Only messages people or agents wrote can be promoted.",
      );
    const quote = await quoted(
      tx,
      message,
      access.channel,
      source.includeThread,
    );
    const ids = {
      workItemId: crypto.randomUUID(),
      decisionId: crypto.randomUUID(),
      threadId: crypto.randomUUID(),
      threadMessageId: crypto.randomUUID(),
    };
    const { command, workItemId } = await commandFor(
      tx,
      target,
      quote,
      ids,
      source.organizationId,
    );
    const result = await applyMutation(
      tx,
      actor,
      {
        protocol: PROTOCOL,
        id: mutationId,
        organizationId: source.organizationId,
        command,
      },
      effects,
    );
    if (result.replayed) {
      // The same mutation id was used outside promotion.
      throw new DomainError(
        "conflict",
        "Mutation ID was already used for a different command.",
      );
    }
    const decisionId = target.kind === "decision" ? ids.decisionId : null;
    const threadId = target.kind === "discussion" ? ids.threadId : null;
    const promotionId = crypto.randomUUID();
    const label = await objectLabel(tx, source.organizationId, workItemId);
    const root = message.threadRootId ?? message.id;
    const reference =
      target.kind === "decision"
        ? formatReference({ kind: "decision", id: decisionId! }, target.title)
        : formatReference({ kind: "item", id: workItemId }, label);
    const card = await appendSystemMessage(tx, {
      organizationId: source.organizationId,
      channelId: source.channelId,
      actorId: actor.userId,
      kind: "card",
      threadRootId: root,
      body:
        target.kind === "proposal"
          ? `promoted this to a proposal: ${reference}`
          : target.kind === "decision"
            ? `recorded a decision on ${formatReference({ kind: "item", id: workItemId }, label)}: ${reference}`
            : `opened a discussion on ${reference}`,
      payload: {
        promotion: target.kind,
        promotionId,
        messageId: message.id,
        workItemId,
        decisionId,
        threadId,
      },
    });
    await tx.insert(s.channelPromotion).values({
      id: promotionId,
      organizationId: source.organizationId,
      channelId: source.channelId,
      messageId: message.id,
      kind: target.kind,
      workItemId,
      decisionId,
      threadId,
      cardMessageId: card.id,
      mutationId,
      createdById: actor.userId,
    });
    return {
      promotionId,
      kind: target.kind,
      workItemId,
      decisionId,
      threadId,
      cardMessageId: card.id,
      mutationId,
      replayed: false,
    };
  });
}

async function existingPromotion(
  tx: Tx,
  organizationId: string,
  mutationId: string,
): Promise<Omit<PromotionResult, "replayed"> | undefined> {
  const [row] = await tx
    .select()
    .from(s.channelPromotion)
    .where(
      and(
        eq(s.channelPromotion.organizationId, organizationId),
        eq(s.channelPromotion.mutationId, mutationId),
      ),
    );
  if (!row) return undefined;
  return {
    promotionId: row.id,
    kind: row.kind,
    workItemId: row.workItemId,
    decisionId: row.decisionId,
    threadId: row.threadId,
    cardMessageId: row.cardMessageId,
    mutationId: row.mutationId,
  };
}

type Message = typeof s.channelMessage.$inferSelect;

// The message (and optionally its thread) as a Markdown quote, attributed,
// with a link back to the conversation.
async function quoted(
  tx: Tx,
  message: Message,
  channel: typeof s.channel.$inferSelect,
  includeThread = false,
) {
  const [org] = await tx
    .select({ slug: s.organization.slug })
    .from(s.organization)
    .where(eq(s.organization.id, channel.organizationId));
  const rootId = message.threadRootId ?? message.id;
  let messages: Message[] = [message];
  if (includeThread) {
    const [root] = await tx
      .select()
      .from(s.channelMessage)
      .where(eq(s.channelMessage.id, rootId));
    const replies = await tx
      .select()
      .from(s.channelMessage)
      .where(
        and(
          eq(s.channelMessage.threadRootId, rootId),
          eq(s.channelMessage.kind, "message"),
          isNull(s.channelMessage.deletedAt),
        ),
      )
      .orderBy(asc(s.channelMessage.sequence))
      .limit(QUOTED_REPLIES);
    messages = [root!, ...replies].filter(
      (m) => !m.deletedAt && m.kind === "message",
    );
  }
  const authorIds = [
    ...new Set(
      messages.flatMap((m) =>
        [m.authorUserId, m.onBehalfOfUserId].filter((v): v is string => !!v),
      ),
    ),
  ];
  const people = authorIds.length
    ? await tx
        .select({ id: s.user.id, name: s.user.name })
        .from(s.user)
        .where(inArray(s.user.id, authorIds))
    : [];
  const name = (m: Message) =>
    people.find((p) => p.id === (m.authorUserId ?? m.onBehalfOfUserId))?.name ??
    "Someone";
  const place = channel.name ? `#${channel.name}` : "a direct conversation";
  const link = `${paths.channel(org?.slug ?? "", channel.id)}?${rootId === message.id ? "" : `thread=${encodeURIComponent(rootId)}&`}message=${encodeURIComponent(message.id)}`;
  const blocks = messages.map(
    (m) =>
      `> **${name(m).replace(/[*_[\]]/g, "")}**\n${m.body
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}`,
  );
  return {
    markdown: `${blocks.join("\n>\n")}\n\nFrom ${place}: [view the conversation](${link})`,
  };
}

async function commandFor(
  tx: Tx,
  target: PromotionTarget,
  quote: { markdown: string },
  ids: {
    workItemId: string;
    decisionId: string;
    threadId: string;
    threadMessageId: string;
  },
  organizationId: string,
): Promise<{ command: Command; workItemId: string }> {
  if (target.kind === "proposal") {
    const typeId =
      target.typeId ??
      (await defaultProposalType(tx, organizationId, target.projectId));
    return {
      workItemId: ids.workItemId,
      command: {
        type: "createWorkItem",
        projectId: target.projectId,
        workItemId: ids.workItemId,
        typeId,
        teamId: target.teamId ?? null,
        parentId: null,
        title: target.title,
        description: quote.markdown,
      },
    };
  }
  const [revision] = await tx
    .select({ id: s.specificationRevision.id })
    .from(s.specificationRevision)
    .where(
      and(
        eq(s.specificationRevision.organizationId, organizationId),
        eq(s.specificationRevision.workItemId, target.workItemId),
      ),
    )
    .orderBy(desc(s.specificationRevision.number))
    .limit(1);
  if (!revision)
    throw new DomainError("not_found", "This work item is unavailable.");
  if (target.kind === "decision")
    return {
      workItemId: target.workItemId,
      command: {
        type: "recordDecision",
        workItemId: target.workItemId,
        baseRevisionId: revision.id,
        decisionId: ids.decisionId,
        title: target.title,
        body: [target.body?.trim(), quote.markdown]
          .filter(Boolean)
          .join("\n\n"),
      },
    };
  return {
    workItemId: target.workItemId,
    command: {
      type: "createThread",
      workItemId: target.workItemId,
      baseRevisionId: revision.id,
      threadId: ids.threadId,
      messageId: ids.threadMessageId,
      body: [target.note?.trim(), quote.markdown].filter(Boolean).join("\n\n"),
      blocking: target.blocking,
      section: target.section,
      ...(target.quote ? { quote: target.quote } : {}),
      ...(target.occurrence !== undefined
        ? { occurrence: target.occurrence }
        : {}),
    },
  };
}

// The project's first enabled specification-backed type, preferring the
// level stories live at (`typeLevels.story`).
async function defaultProposalType(
  tx: Tx,
  organizationId: string,
  projectId: string,
) {
  const types = await tx
    .select({
      id: s.workItemType.id,
      level: s.workItemType.level,
      position: s.workItemType.position,
    })
    .from(s.projectWorkItemType)
    .innerJoin(
      s.workItemType,
      and(
        eq(s.workItemType.organizationId, s.projectWorkItemType.organizationId),
        eq(s.workItemType.id, s.projectWorkItemType.typeId),
      ),
    )
    .where(
      and(
        eq(s.projectWorkItemType.organizationId, organizationId),
        eq(s.projectWorkItemType.projectId, projectId),
        eq(s.workItemType.hasSpecification, true),
        isNull(s.workItemType.archivedAt),
      ),
    );
  const chosen = types.sort(
    (a, b) =>
      Number(a.level !== typeLevels.story) -
        Number(b.level !== typeLevels.story) ||
      a.level - b.level ||
      a.position - b.position,
  )[0];
  if (!chosen)
    throw new DomainError(
      "validation",
      "This project has no work item type with a specification. Enable one in the project's settings, or name `typeId`.",
    );
  return chosen.id;
}

async function objectLabel(tx: Tx, organizationId: string, workItemId: string) {
  const [row] = await tx
    .select({ number: s.workItem.number, key: s.project.key })
    .from(s.workItem)
    .innerJoin(
      s.project,
      and(
        eq(s.project.organizationId, s.workItem.organizationId),
        eq(s.project.id, s.workItem.projectId),
      ),
    )
    .where(
      and(
        eq(s.workItem.organizationId, organizationId),
        eq(s.workItem.id, workItemId),
      ),
    );
  return row ? `${row.key}-${row.number}` : "work item";
}
