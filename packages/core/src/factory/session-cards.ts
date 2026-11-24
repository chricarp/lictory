import { and, eq, inArray } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type { Tx } from "@lictory/core/domain/service";
import {
  appendSystemMessage,
  postAgentMessage,
  updateCardPayload,
} from "@lictory/core/channels/writer";
import { formatReference } from "@lictory/core/contracts/references";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { paths } from "@lictory/core/lib/paths";
import type { SessionRow } from "@lictory/core/factory/store";
import { sessionCardId, stableId } from "@lictory/core/factory/thread-ids";

// What a session shows in its steering thread
// (docs/internals/factory.md#sessions-in-channels): one live card (agent via
// owner, status, work item, the Factory link), an approval card per request
// with who may decide, the agent's answers to people and its summary. The
// full event log stays in the Factory. Every write has a stable id, so
// writing it again changes the card in place instead of adding a message.
//
// Callers hold the organization lock (shared or exclusive); these writes
// take the conversation's lock through the conversation writer.

type AgentRow = typeof s.agent.$inferSelect;
type ApprovalRow = typeof s.agentApproval.$inferSelect;

const sessionStatusLabels: Record<SessionRow["status"], string> = {
  queued: "Queued for a runner",
  assigned: "Starting",
  running: "Working",
  waiting: "Waiting on a person",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};

// The card's synchronized payload (`channel_message.payload`). The browser
// renders it live from the session's own projection when it can read it;
// the payload is what MCP readers and a browser without the Factory see.
export type SessionCardPayload = {
  type: "agentSession";
  sessionId: string;
  agentId: string;
  agentName: string;
  agentHandle: string;
  ownerId: string;
  requestedById: string;
  status: SessionRow["status"];
  title: string;
  workItemId: string | null;
  workItemKey: string | null;
  summary: string | null;
  error: string | null;
  path: string;
  // The code pull request its branch became: Lictory's page and the host's.
  pullRequest: { id: string; path: string; url: string | null } | null;
};

export type ApprovalCardPayload = {
  type: "agentApproval";
  sessionId: string;
  approvalId: string;
  agentId: string;
  agentName: string;
  ownerId: string;
  title: string;
  tool: string | null;
  reason: string | null;
  status: ApprovalRow["status"];
  decidedById: string | null;
  note: string | null;
  // Only these people may answer: the session's requester and the agent's
  // owner. Everyone else sees who decides.
  deciderIds: string[];
};

export type QuestionCardPayload = {
  type: "agentQuestion";
  claimId: string;
  sessionId: string | null;
  agentName: string;
  ownerId: string;
  workItemId: string;
  itemKey: string;
  questionItemId: string;
  questionItemKey: string;
  threadId: string;
  question: string;
  status: "open" | "resolved";
  resolvedById: string | null;
  path: string;
};

async function organizationSlug(tx: Tx, organizationId: string) {
  const [org] = await tx
    .select({ slug: s.organization.slug })
    .from(s.organization)
    .where(eq(s.organization.id, organizationId));
  return org?.slug ?? "";
}

async function activeChannel(tx: Tx, organizationId: string, id: string) {
  const [channel] = await tx
    .select({ id: s.channel.id, archivedAt: s.channel.archivedAt })
    .from(s.channel)
    .where(
      and(eq(s.channel.organizationId, organizationId), eq(s.channel.id, id)),
    );
  return channel && !channel.archivedAt ? channel : undefined;
}

async function itemKeyOf(tx: Tx, workItemId: string | null) {
  if (!workItemId) return null;
  const [row] = await tx
    .select({
      number: s.workItem.number,
      key: s.project.key,
      projectId: s.project.id,
    })
    .from(s.workItem)
    .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
    .where(eq(s.workItem.id, workItemId));
  return row ? { key: `${row.key}-${row.number}`, project: row.key } : null;
}

const url = (path: string) => `${platformUrl().replace(/\/$/, "")}${path}`;

// The session's thread: top level when the card is the thread itself.
function threadOf(session: SessionRow) {
  if (!session.channelId || !session.threadRootMessageId) return null;
  const cardId = sessionCardId(session.id);
  return {
    channelId: session.channelId,
    rootId: session.threadRootMessageId,
    cardId,
    topLevel: session.threadRootMessageId === cardId,
  };
}

/** Writes or refreshes the session's card in its thread. */
export async function syncSessionCard(
  tx: Tx,
  session: SessionRow,
  agent: AgentRow,
) {
  const thread = threadOf(session);
  if (!thread) return null;
  if (!(await activeChannel(tx, session.organizationId, thread.channelId)))
    return null;
  const [slug, item] = await Promise.all([
    organizationSlug(tx, session.organizationId),
    itemKeyOf(tx, session.workItemId),
  ]);
  const path = paths.factorySession(slug, session.id);
  const payload: SessionCardPayload = {
    type: "agentSession",
    sessionId: session.id,
    agentId: agent.id,
    agentName: agent.name,
    agentHandle: agent.handle,
    ownerId: agent.ownerId,
    requestedById: session.requestedById,
    status: session.status,
    title: session.title,
    workItemId: session.workItemId,
    workItemKey: item?.key ?? null,
    summary: session.resultSummary?.slice(0, 2000) ?? null,
    error: session.error?.slice(0, 1000) ?? null,
    path,
    pullRequest: session.pullRequestId
      ? {
          id: session.pullRequestId,
          path: paths.codePullRequest(slug, session.pullRequestId),
          url: session.pullRequestUrl,
        }
      : null,
  };
  const body = [
    `**${agent.name}** · ${sessionStatusLabels[session.status]}`,
    item && session.workItemId
      ? ` · ${formatReference({ kind: "item", id: session.workItemId }, item.key)}`
      : "",
    `\n\n${session.title}`,
    payload.pullRequest
      ? `\n\n[Pull request](${url(payload.pullRequest.path)})`
      : "",
    `\n\n[Open the session in the Factory](${url(path)})`,
  ].join("");
  const message = await appendSystemMessage(tx, {
    organizationId: session.organizationId,
    channelId: thread.channelId,
    actorId: session.requestedById,
    kind: "card",
    body,
    payload,
    threadRootId: thread.topLevel ? null : thread.rootId,
    messageId: thread.cardId,
  });
  if (JSON.stringify(message.payload) !== JSON.stringify(payload))
    await updateCardPayload(tx, {
      organizationId: session.organizationId,
      channelId: thread.channelId,
      messageId: thread.cardId,
      payload,
      body,
    });
  return thread.cardId;
}

/** Writes or refreshes an approval request's card in the session's thread. */
export async function syncApprovalCard(
  tx: Tx,
  session: SessionRow,
  agent: AgentRow,
  approval: ApprovalRow,
) {
  const thread = threadOf(session);
  if (!thread) return null;
  if (!(await activeChannel(tx, session.organizationId, thread.channelId)))
    return null;
  // The thread exists once its card does (a dispatched session's card is
  // its thread).
  await syncSessionCard(tx, session, agent);
  const detail = (approval.detail ?? {}) as {
    tool?: string | null;
    reason?: string | null;
  };
  const payload: ApprovalCardPayload = {
    type: "agentApproval",
    sessionId: session.id,
    approvalId: approval.id,
    agentId: agent.id,
    agentName: agent.name,
    ownerId: agent.ownerId,
    title: approval.title,
    tool: detail.tool ?? null,
    reason: detail.reason ?? null,
    status: approval.status,
    decidedById: approval.decidedById,
    note: approval.note,
    deciderIds: [...new Set([session.requestedById, agent.ownerId])],
  };
  const id = stableId("approval", approval.id);
  const body = `**${agent.name}** asks to: ${approval.title}${
    approval.status === "pending"
      ? ""
      : ` (${approval.status === "approved" ? "approved" : approval.status === "denied" ? "denied" : "expired"})`
  }`;
  const message = await appendSystemMessage(tx, {
    organizationId: session.organizationId,
    channelId: thread.channelId,
    actorId: session.requestedById,
    kind: "card",
    body,
    payload,
    threadRootId: thread.rootId,
    messageId: id,
  });
  if (JSON.stringify(message.payload) !== JSON.stringify(payload))
    await updateCardPayload(tx, {
      organizationId: session.organizationId,
      channelId: thread.channelId,
      messageId: id,
      payload,
      body,
    });
  return id;
}

/** Refreshes the cards of every approval of a session that changed. */
export async function syncApprovalCards(
  tx: Tx,
  session: SessionRow,
  agent: AgentRow,
) {
  if (!threadOf(session)) return;
  const approvals = await tx
    .select()
    .from(s.agentApproval)
    .where(eq(s.agentApproval.sessionId, session.id));
  const ids = approvals.map((a) => stableId("approval", a.id));
  if (!ids.length) return;
  // Only cards already posted change (a request answered before its card
  // was written still gets one).
  const posted = new Set(
    (
      await tx
        .select({ id: s.channelMessage.id })
        .from(s.channelMessage)
        .where(
          and(
            eq(s.channelMessage.organizationId, session.organizationId),
            inArray(s.channelMessage.id, ids),
          ),
        )
    ).map((r) => r.id),
  );
  for (const approval of approvals)
    if (
      approval.status === "pending" ||
      posted.has(stableId("approval", approval.id))
    )
      await syncApprovalCard(tx, session, agent, approval);
}

/** What the agent said, posted in its thread as the agent via its owner. */
export async function postSessionMessage(
  tx: Tx,
  session: SessionRow,
  agent: AgentRow,
  key: string,
  text: string,
) {
  const thread = threadOf(session);
  if (!thread || !text.trim()) return null;
  if (!(await activeChannel(tx, session.organizationId, thread.channelId)))
    return null;
  await syncSessionCard(tx, session, agent);
  const posted = await postAgentMessage(tx, {
    organizationId: session.organizationId,
    channelId: thread.channelId,
    threadRootId: thread.rootId,
    messageId: stableId("message", session.id, key),
    agentId: agent.id,
    onBehalfOfUserId: agent.ownerId,
    body: text,
  });
  return posted?.message.id ?? null;
}

type QuestionAnnouncement = {
  organizationId: string;
  claimId: string;
  sessionId: string | null;
  agentName: string;
  ownerId: string;
  workItemId: string;
  itemKey: string;
  questionItemId: string;
  questionItemKey: string;
  threadId: string;
  question: string;
};

const questionCardIds = (threadId: string) => [
  stableId("question", threadId, "session"),
  stableId("question", threadId, "report"),
];

/**
 * Announces an agent's question: in its session's thread, and at the top
 * of the project's reporting channel when it has one. Each card links to
 * the anchored discussion where people answer.
 */
export async function announceQuestion(
  tx: Tx,
  question: QuestionAnnouncement,
  places: {
    session: SessionRow | null;
    agent: AgentRow | null;
    reportingChannelId: string | null;
  },
) {
  const [slug, item] = await Promise.all([
    organizationSlug(tx, question.organizationId),
    itemKeyOf(tx, question.questionItemId),
  ]);
  // The item, where the question is anchored on the specification's text
  // and its discussion is listed (the item page has no deep link to one
  // discussion yet).
  const path = paths.item(slug, item?.project ?? "", question.questionItemId);
  const payload: QuestionCardPayload = {
    type: "agentQuestion",
    claimId: question.claimId,
    sessionId: question.sessionId,
    agentName: question.agentName,
    ownerId: question.ownerId,
    workItemId: question.workItemId,
    itemKey: question.itemKey,
    questionItemId: question.questionItemId,
    questionItemKey: question.questionItemKey,
    threadId: question.threadId,
    question: question.question,
    status: "open",
    resolvedById: null,
    path,
  };
  const body = `**${question.agentName}** asks about ${formatReference(
    { kind: "item", id: question.questionItemId },
    question.questionItemKey,
  )}: ${question.question}\n\n${question.itemKey} waits for the answer. [Answer in the discussion](${url(path)})`;
  const [inSession, inReport] = questionCardIds(question.threadId);
  const posted: string[] = [];
  const thread = places.session ? threadOf(places.session) : null;
  if (
    thread &&
    places.session &&
    places.agent &&
    (await activeChannel(tx, question.organizationId, thread.channelId))
  ) {
    await syncSessionCard(tx, places.session, places.agent);
    await appendSystemMessage(tx, {
      organizationId: question.organizationId,
      channelId: thread.channelId,
      actorId: question.ownerId,
      kind: "card",
      body,
      payload,
      threadRootId: thread.rootId,
      messageId: inSession,
    });
    posted.push(inSession!);
  }
  if (
    places.reportingChannelId &&
    (await activeChannel(
      tx,
      question.organizationId,
      places.reportingChannelId,
    ))
  ) {
    await appendSystemMessage(tx, {
      organizationId: question.organizationId,
      channelId: places.reportingChannelId,
      actorId: question.ownerId,
      kind: "card",
      body,
      payload,
      messageId: inReport,
    });
    posted.push(inReport!);
  }
  return posted;
}

/** Marks a question's cards resolved. */
export async function resolveQuestionCards(
  tx: Tx,
  organizationId: string,
  threadId: string,
  resolvedById: string,
) {
  const cards = await tx
    .select({
      id: s.channelMessage.id,
      channelId: s.channelMessage.channelId,
      payload: s.channelMessage.payload,
      body: s.channelMessage.body,
    })
    .from(s.channelMessage)
    .where(
      and(
        eq(s.channelMessage.organizationId, organizationId),
        inArray(s.channelMessage.id, questionCardIds(threadId)),
      ),
    );
  for (const card of cards)
    await updateCardPayload(tx, {
      organizationId,
      channelId: card.channelId,
      messageId: card.id,
      payload: { ...card.payload, status: "resolved", resolvedById },
    });
}
