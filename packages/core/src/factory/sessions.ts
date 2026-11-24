import { createHash, randomBytes } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  agentApproval,
  agentSession,
} from "@lictory/core/contracts/state-machines";
import { aiPolicy } from "@lictory/core/domain/ai";
import { DomainError, requireStep } from "@lictory/core/domain/errors";
import {
  authorize,
  isAdmin,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import {
  assertAgentProject,
  assertPerson,
  type AgentScope,
} from "@lictory/core/factory/authority";
import { policyStarter } from "@lictory/core/claims/contracts";
import {
  sessionEntity,
  type SessionStatus,
} from "@lictory/core/factory/entities";
import {
  publishSessionEvent,
  resolveSessionWorkspace,
  sessionPushed,
  type SessionCompletion,
  type SessionThreadEvent,
} from "@lictory/core/factory/ports";
import { suggestBranchName } from "@lictory/core/code/keys";
import {
  LEASE_SECONDS,
  boundEvent,
  harnessIds,
  limits,
  runnerEventSchema,
  type Assignment,
  type HarnessId,
  type RunnerEvent,
  type SessionInput,
} from "@lictory/core/factory/protocol";
import type { RunnerRow } from "@lictory/core/factory/runners";
import { signalFactory } from "@lictory/core/factory/signals";
import {
  appendEvents,
  expireApprovals,
  factoryWrite,
  latestEvents,
  lockSession,
  present,
  projectSession,
  revokeSessionTokens,
  updateSession,
  type SessionRow,
} from "@lictory/core/factory/store";
import { sessionCardId } from "@lictory/core/factory/thread-ids";
import { readChannelAccess } from "@lictory/core/channels/access";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { queueNotifications } from "@lictory/core/notifications/events";

// Agent sessions (docs/internals/factory.md#sessions): one run of an agent on
// one task. People start and steer them through capabilities; runners claim
// them on a lease and report through the runner protocol. Every status
// change goes through the declared machine (`agentSession`).

export type SessionActor = {
  userId: string;
  // Set when a Factory agent calls (its owner's id is `userId`).
  agent?: AgentScope | null;
};

const ACTIVE: SessionStatus[] = ["assigned", "running", "waiting"];
const SESSION_TOKEN_MS = 24 * 60 * 60_000;
const MAX_PROMPT = 20_000;
const MAX_MESSAGE = 8_000;

const notFound = () =>
  new DomainError("not_found", "This agent session does not exist.");

// --------------------------------------------------------------- helpers

function derivedId(mutationId: string) {
  const h = createHash("sha256")
    .update(`${mutationId}:agentSession`)
    .digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Repository addresses a runner may clone: https or ssh, never with
// credentials embedded (they would be stored and shown to everyone).
export function repositoryProblem(url: string) {
  const scp = /^[\w.-]+@[\w.-]+:[\w./~-]+$/;
  if (scp.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Enter the repository's https or ssh clone address.";
  }
  if (!["https:", "ssh:", "http:"].includes(parsed.protocol))
    return "Enter the repository's https or ssh clone address.";
  if (parsed.password || (parsed.protocol !== "ssh:" && parsed.username))
    return "Remove the credentials from the address. Runners get repository access from the code host integration or their own git credentials.";
  return null;
}

const branchShape =
  /^(?!\/)(?!.*\/\/)(?!.*\.\.)(?!.*@\{)[\w./-]{1,200}(?<![./])$/;

// A branch named for the item (its key and title, as Code suggests, so key
// detection links it) and the session, so two sessions never share one.
function defaultBranch(
  agent: { handle: string },
  sessionId: string,
  item: { key: string; title: string } | null,
) {
  const short = sessionId.replaceAll("-", "").slice(0, 8);
  return item
    ? `${suggestBranchName(item.key, item.title, "lictory").slice(0, 160)}-${short}`
    : `lictory/${agent.handle.replaceAll("_", "-")}-${short}`;
}

async function memberName(tx: Tx | Database, userId: string) {
  const [row] = await tx
    .select({ name: s.user.name })
    .from(s.user)
    .where(eq(s.user.id, userId));
  return row?.name ?? "Someone";
}

async function agentOf(tx: Tx | Database, session: SessionRow) {
  const [row] = await tx
    .select()
    .from(s.agent)
    .where(eq(s.agent.id, session.agentId));
  return row!;
}

// Who may steer a session: the person who started it and the agent's owner.
function canSteer(
  session: SessionRow,
  agent: typeof s.agent.$inferSelect,
  userId: string,
) {
  return session.requestedById === userId || agent.ownerId === userId;
}

async function steerable(
  tx: Tx,
  actor: SessionActor,
  organizationId: string,
  sessionId: string,
  options: { adminMay?: boolean } = {},
) {
  const membership = await authorize(tx, actor.userId, organizationId);
  const session = await lockSession(tx, organizationId, sessionId);
  if (!session) throw notFound();
  const agent = await agentOf(tx, session);
  assertAgentProject(actor.agent, session.projectId);
  if (
    !canSteer(session, agent, actor.userId) &&
    !(options.adminMay && isAdmin(membership))
  )
    throw new DomainError(
      "forbidden",
      `Only the person who started this session or ${agent.name}'s owner can steer it.`,
    );
  return { session, agent, membership };
}

async function addInput(
  tx: Tx,
  session: SessionRow,
  kind: SessionInput["kind"],
  data: Record<string, unknown>,
  userId: string | null,
) {
  const sequence = session.inputSequence + 1;
  await tx.insert(s.agentSessionInput).values({
    organizationId: session.organizationId,
    sessionId: session.id,
    sequence,
    kind,
    data,
    createdById: userId,
  });
  await signalFactory(tx, {
    organizationId: session.organizationId,
    sessionId: session.id,
  });
  return sequence;
}

// Ends the current run's credentials and questions; used whenever a
// session leaves the active states.
async function endRun(tx: Tx, session: SessionRow) {
  await expireApprovals(tx, session.id);
  await revokeSessionTokens(tx, session.id);
}

function threadEvent(
  session: SessionRow,
  kind: SessionThreadEvent["kind"],
  approvalId?: string,
): SessionThreadEvent {
  return {
    organizationId: session.organizationId,
    sessionId: session.id,
    channelId: session.channelId,
    threadRootMessageId: session.threadRootMessageId,
    kind,
    status: session.status,
    ...(approvalId ? { approvalId } : {}),
  };
}

// Tells the person who started the session how it ended.
async function notifyFinished(tx: Tx, session: SessionRow) {
  if (session.status !== "completed" && session.status !== "failed") return;
  const agent = await agentOf(tx, session);
  await queueNotifications(tx, session.organizationId, [
    {
      userIds: [session.requestedById],
      kind: "agent_session_finished",
      actorId: null,
      detail: {
        sessionId: session.id,
        sessionTitle: session.title,
        agentName: agent.name,
        status: session.status,
        summary: session.resultSummary?.slice(0, 300) ?? null,
        error: session.error?.slice(0, 300) ?? null,
      },
      dedupeKey: `agent-session:${session.id}:${session.attempts}:${session.status}`,
    },
  ]);
}

// Runs a Factory write and publishes the thread events it produced after
// the transaction committed.
async function writeAndPublish<T>(
  db: Database,
  organizationId: string,
  write: (tx: Tx, publish: (event: SessionThreadEvent) => void) => Promise<T>,
) {
  const events: SessionThreadEvent[] = [];
  const result = await factoryWrite(db, organizationId, (tx) =>
    write(tx, (event) => events.push(event)),
  );
  for (const event of events) await publishSessionEvent(event);
  return result;
}

// ------------------------------------------------------- person commands

export type StartSessionInput = {
  organizationId: string;
  agentId: string;
  prompt: string;
  title?: string;
  workItemId?: string | null;
  repositoryUrl?: string | null;
  // A repository of the Code module (its id); the workspace resolver
  // checks that it serves the item's project and the owner may use it.
  repositoryId?: string | null;
  baseBranch?: string | null;
  branch?: string | null;
  runnerId?: string | null;
  channelId?: string | null;
  threadRootMessageId?: string | null;
  sessionId?: string;
  mutationId?: string;
  maxAttempts?: number;
  // Server callers only (never a capability's input): what Lictory tells
  // the agent besides the task, and the autonomy policy that started it.
  context?: string | null;
  startedByPolicy?: { level: "build" | "autopilot"; setById: string } | null;
};

// Checks that `userId` may start a session with this agent now.
async function assertCanStart(
  tx: Tx,
  userId: string,
  agent: typeof s.agent.$inferSelect,
) {
  if (agent.archivedAt)
    throw new DomainError(
      "conflict",
      `${agent.name} is archived. Restore it to start sessions.`,
      undefined,
      "invalid_state",
    );
  if (agent.kind !== "runner")
    throw new DomainError(
      "validation",
      agent.kind === "external"
        ? `${agent.name} is an external agent: it connects through its own MCP client and runs no sessions here.`
        : "Lictory Intelligence runs its reviews itself; it has no sessions.",
    );
  if (agent.ownerId !== userId && !agent.shared)
    throw new DomainError(
      "forbidden",
      `${agent.name} is private to its owner. Ask them to share it with the organization or start the session for you.`,
    );
  // The agent acts as its owner, who must still belong to the organization.
  const owner = await authorize(tx, agent.ownerId, agent.organizationId).catch(
    () => null,
  );
  if (!owner)
    throw new DomainError(
      "conflict",
      `${agent.name}'s owner is no longer a member of this organization, so it cannot act. Archive it or create a new agent.`,
    );
}

export async function startSession(
  db: Database,
  actor: SessionActor,
  input: StartSessionInput,
  options: { trustedChannel?: boolean } = {},
) {
  return writeAndPublish(db, input.organizationId, (tx, publish) =>
    startSessionIn(tx, actor, input, publish, options),
  );
}

// Starts a session in the caller's transaction, which holds the
// organization lock (shared at least): the conversation writer starts the
// session an agent mention asks for in the message's own transaction. Thread
// events are handed to `publish`; the caller publishes them after commit.
export async function startSessionIn(
  tx: Tx,
  actor: SessionActor,
  input: StartSessionInput,
  publish: (event: SessionThreadEvent) => void,
  options: {
    // The caller chose the channel (the dispatcher's reporting channel, set
    // by a project administrator): the requester need not be a member.
    trustedChannel?: boolean;
  } = {},
) {
  const { organizationId } = input;
  const sessionId =
    input.sessionId ??
    (input.mutationId ? derivedId(input.mutationId) : crypto.randomUUID());
  {
    await authorize(tx, actor.userId, organizationId);
    if (actor.agent?.sessionId)
      throw new DomainError(
        "forbidden",
        "An agent session cannot start other sessions. Ask the person who started it.",
        undefined,
        "agent_scope",
      );
    const [existing] = await tx
      .select()
      .from(s.agentSession)
      .where(
        and(
          eq(s.agentSession.organizationId, organizationId),
          eq(s.agentSession.id, sessionId),
        ),
      );
    if (existing) {
      // A retried start returns the session it created.
      if (existing.requestedById !== actor.userId)
        throw new DomainError("conflict", "This session id is already used.");
      return sessionEntity(existing, []);
    }
    const [agent] = await tx
      .select()
      .from(s.agent)
      .where(
        and(
          eq(s.agent.organizationId, organizationId),
          eq(s.agent.id, input.agentId),
        ),
      );
    if (!agent)
      throw new DomainError("not_found", "This agent does not exist.");
    await assertCanStart(tx, actor.userId, agent);
    const prompt = input.prompt.trim();
    if (!prompt)
      throw new DomainError("validation", "Tell the agent what to do.");
    if (prompt.length > MAX_PROMPT)
      throw new DomainError(
        "validation",
        `Keep the instructions under ${MAX_PROMPT.toLocaleString("en")} characters; link to the work item or a page for the rest.`,
      );
    let item:
      { id: string; key: string; title: string; projectId: string } | undefined;
    if (input.workItemId) {
      const [found] = await tx
        .select({
          id: s.workItem.id,
          number: s.workItem.number,
          title: s.workItem.title,
          projectId: s.workItem.projectId,
          key: s.project.key,
        })
        .from(s.workItem)
        .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
        .where(
          and(
            eq(s.workItem.organizationId, organizationId),
            eq(s.workItem.id, input.workItemId),
            isNull(s.workItem.archivedAt),
          ),
        );
      if (!found)
        throw new DomainError("not_found", "This work item is unavailable.");
      item = { ...found, key: `${found.key}-${found.number}` };
      // Within the agent's scope, and the calling agent's.
      assertAgentProject(
        {
          id: agent.id,
          organizationId,
          name: agent.name,
          handle: agent.handle,
          access: agent.access === "read" ? "read" : "write",
          projectIds: agent.projectIds,
          sessionId: null,
        },
        item.projectId,
      );
      assertAgentProject(actor.agent, item.projectId);
    } else if (actor.agent?.projectIds) assertAgentProject(actor.agent, null);
    const repositoryUrl = present(input.repositoryUrl);
    if (repositoryUrl) {
      const problem = repositoryProblem(repositoryUrl);
      if (problem) throw new DomainError("validation", problem);
    }
    const branch =
      present(input.branch) ?? defaultBranch(agent, sessionId, item ?? null);
    if (!branchShape.test(branch))
      throw new DomainError("validation", "That branch name is not valid.");
    const baseBranch = present(input.baseBranch);
    if (baseBranch && !branchShape.test(baseBranch))
      throw new DomainError(
        "validation",
        "That base branch name is not valid.",
      );
    const channelId = present(input.channelId);
    let threadRootMessageId = present(input.threadRootMessageId);
    if (channelId) {
      // A session posts its card and its agent's replies in this thread,
      // so the person starting it must be able to post there.
      if (!options.trustedChannel) {
        const access = await readChannelAccess(
          tx,
          organizationId,
          actor.userId,
          channelId,
          false,
        );
        if (!access.canPost)
          throw new DomainError(
            "forbidden",
            "Join the channel (and make sure it is not archived) to start a session in its thread.",
          );
      }
      if (threadRootMessageId) {
        const [root] = await tx
          .select({ threadRootId: s.channelMessage.threadRootId })
          .from(s.channelMessage)
          .where(
            and(
              eq(s.channelMessage.organizationId, organizationId),
              eq(s.channelMessage.channelId, channelId),
              eq(s.channelMessage.id, threadRootMessageId),
            ),
          );
        if (!root)
          throw new DomainError("not_found", "This message is unavailable.");
        threadRootMessageId = root.threadRootId ?? threadRootMessageId;
      } else threadRootMessageId = sessionCardId(sessionId);
    } else threadRootMessageId = null;
    const requestedRunnerId = input.runnerId ?? agent.defaultRunnerId ?? null;
    if (requestedRunnerId) {
      const [runner] = await tx
        .select()
        .from(s.runner)
        .where(
          and(
            eq(s.runner.organizationId, organizationId),
            eq(s.runner.id, requestedRunnerId),
            isNull(s.runner.revokedAt),
          ),
        );
      if (!runner)
        throw new DomainError("validation", "That runner is unavailable.");
      if (runner.ownerId && runner.ownerId !== agent.ownerId)
        throw new DomainError(
          "forbidden",
          `${runner.name} is a personal runner; it only runs its owner's agents.`,
        );
    }
    const title = (
      present(input.title) ??
      item?.title ??
      prompt.split("\n")[0]!
    ).slice(0, 200);
    const [row] = await tx
      .insert(s.agentSession)
      .values({
        id: sessionId,
        organizationId,
        agentId: agent.id,
        requestedById: actor.userId,
        requestedRunnerId,
        status: "queued",
        title,
        prompt,
        context: present(input.context),
        startedByPolicy: input.startedByPolicy ?? null,
        workItemId: item?.id ?? null,
        projectId: item?.projectId ?? null,
        repositoryUrl,
        repositoryId: present(input.repositoryId),
        baseBranch,
        branch,
        channelId,
        threadRootMessageId,
        maxAttempts: input.maxAttempts ?? 3,
      })
      .returning();
    const requester = await memberName(tx, actor.userId);
    const policy = input.startedByPolicy ?? null;
    const starter = policy
      ? policyStarter(policy, await memberName(tx, policy.setById))
      : requester;
    const context = present(input.context);
    // The task is a person's message only when a person wrote it; what
    // Lictory adds (where it was asked, a policy's instructions) is its own
    // event, never attributed to someone who did not write it.
    const sequence = await appendEvents(tx, row!, [
      policy
        ? {
            type: "context",
            data: {
              source: "policy",
              summary: `The ${starter} dispatched this task.`,
              text: [prompt, ...(context ? ["", context] : [])].join("\n"),
            },
          }
        : {
            type: "user_message",
            data: {
              text: prompt,
              authorId: actor.userId,
              authorName: requester,
            },
          },
      ...(context && !policy
        ? [
            {
              type: "context" as const,
              data: { source: "lictory", text: context },
            },
          ]
        : []),
      {
        type: "status",
        data: {
          phase: "queued",
          status: "queued",
          message: `${policy ? `The ${starter}` : requester} started the session.`,
          byId: policy ? policy.setById : actor.userId,
          ...(policy ? { policy } : {}),
        },
      },
    ]);
    const session = await updateSession(tx, row!.id, {
      eventSequence: sequence,
    });
    await projectSession(tx, session);
    await signalFactory(tx, { organizationId });
    publish(threadEvent(session, "started"));
    return sessionEntity(session, []);
  }
}

export async function sendSessionMessage(
  db: Database,
  actor: SessionActor,
  input: { organizationId: string; sessionId: string; text: string },
) {
  return factoryWrite(db, input.organizationId, (tx) =>
    sendSessionMessageIn(tx, actor, input),
  );
}

// A steering message in the caller's transaction (organization lock held):
// replies in a session's thread by the person who started it or the agent's
// owner reach the agent this way, in the reply's own transaction.
export async function sendSessionMessageIn(
  tx: Tx,
  actor: SessionActor,
  input: {
    organizationId: string;
    sessionId: string;
    text: string;
    // Where the message came from, recorded with it ("in #payments").
    source?: { channelId: string; messageId: string } | null;
  },
) {
  const text = input.text.trim();
  if (!text) throw new DomainError("validation", "Write a message.");
  if (text.length > MAX_MESSAGE)
    throw new DomainError(
      "validation",
      `Keep messages under ${MAX_MESSAGE.toLocaleString("en")} characters.`,
    );
  {
    const { session } = await steerable(
      tx,
      actor,
      input.organizationId,
      input.sessionId,
    );
    requireStep(agentSession, session.status, "sendMessage");
    const authorName = await memberName(tx, actor.userId);
    const data = {
      text,
      authorId: actor.userId,
      authorName,
      ...(actor.agent ? { viaAgent: actor.agent.name } : {}),
      ...(input.source
        ? {
            channelId: input.source.channelId,
            messageId: input.source.messageId,
          }
        : {}),
    };
    const inputSequence = await addInput(
      tx,
      session,
      "message",
      data,
      actor.userId,
    );
    const eventSequence = await appendEvents(tx, session, [
      { type: "user_message", data },
    ]);
    const row = await updateSession(tx, session.id, {
      inputSequence,
      eventSequence,
    });
    await projectSession(tx, row);
    return { sessionId: row.id, sequence: eventSequence };
  }
}

export async function interruptSession(
  db: Database,
  actor: SessionActor,
  input: { organizationId: string; sessionId: string },
) {
  return factoryWrite(db, input.organizationId, async (tx) => {
    const { session } = await steerable(
      tx,
      actor,
      input.organizationId,
      input.sessionId,
    );
    requireStep(agentSession, session.status, "interrupt");
    const name = await memberName(tx, actor.userId);
    const inputSequence = await addInput(
      tx,
      session,
      "interrupt",
      {},
      actor.userId,
    );
    const eventSequence = await appendEvents(tx, session, [
      {
        type: "status",
        data: {
          phase: "interrupt_requested",
          status: session.status,
          message: `${name} interrupted the agent.`,
          byId: actor.userId,
        },
      },
    ]);
    const row = await updateSession(tx, session.id, {
      inputSequence,
      eventSequence,
    });
    await projectSession(tx, row);
    return sessionEntity(row, []);
  });
}

export async function cancelSession(
  db: Database,
  actor: SessionActor,
  input: { organizationId: string; sessionId: string },
) {
  return writeAndPublish(db, input.organizationId, async (tx, publish) => {
    const { session } = await steerable(
      tx,
      actor,
      input.organizationId,
      input.sessionId,
      { adminMay: true },
    );
    requireStep(agentSession, session.status, "cancel");
    if (session.status === "canceled") return sessionEntity(session, []);
    const name = await memberName(tx, actor.userId);
    const inputSequence = await addInput(
      tx,
      session,
      "cancel",
      {},
      actor.userId,
    );
    const eventSequence = await appendEvents(tx, session, [
      {
        type: "status",
        data: {
          phase: "canceled",
          status: "canceled",
          message: `${name} canceled the session.`,
          byId: actor.userId,
        },
      },
    ]);
    await endRun(tx, session);
    const row = await updateSession(tx, session.id, {
      status: "canceled",
      inputSequence,
      eventSequence,
      // The runner's later writes fail: its lease is gone.
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: new Date(),
    });
    await projectSession(tx, row);
    publish(threadEvent(row, "status"));
    return sessionEntity(row, []);
  });
}

export async function retrySession(
  db: Database,
  actor: SessionActor,
  input: { organizationId: string; sessionId: string },
) {
  return writeAndPublish(db, input.organizationId, async (tx, publish) => {
    const { session, agent } = await steerable(
      tx,
      actor,
      input.organizationId,
      input.sessionId,
    );
    requireStep(agentSession, session.status, "retry");
    await assertCanStart(tx, actor.userId, agent);
    const name = await memberName(tx, actor.userId);
    const eventSequence = await appendEvents(tx, session, [
      {
        type: "status",
        data: {
          phase: "queued",
          status: "queued",
          message: `${name} retried the session.`,
          byId: actor.userId,
        },
      },
    ]);
    const row = await updateSession(tx, session.id, {
      status: "queued",
      eventSequence,
      attempts: 0,
      runnerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      runnerSequence: 0,
      // Inputs of the earlier run (its cancel among them) stay behind.
      inputCursor: session.inputSequence,
      error: null,
      resultSummary: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
    });
    await projectSession(tx, row);
    await signalFactory(tx, { organizationId: row.organizationId });
    publish(threadEvent(row, "status"));
    return sessionEntity(row, []);
  });
}

// A person's answer to what the agent asked. Only the person who started
// the session or the agent's owner decides; an agent never answers.
export async function answerApproval(
  db: Database,
  actor: SessionActor,
  input: {
    organizationId: string;
    sessionId: string;
    approvalId: string;
    decision: "approve" | "deny";
    note?: string | null;
  },
) {
  assertPerson(actor.agent, "answering an approval request");
  return writeAndPublish(db, input.organizationId, async (tx, publish) => {
    const { session } = await steerable(
      tx,
      actor,
      input.organizationId,
      input.sessionId,
    );
    const [approval] = await tx
      .select()
      .from(s.agentApproval)
      .where(
        and(
          eq(s.agentApproval.sessionId, session.id),
          eq(s.agentApproval.id, input.approvalId),
        ),
      )
      .for("update");
    if (!approval)
      throw new DomainError(
        "not_found",
        "This approval request does not exist.",
      );
    requireStep(agentApproval, approval.status, "answer");
    requireStep(agentSession, session.status, "answerApproval");
    const status = input.decision === "approve" ? "approved" : "denied";
    const note = present(input.note?.slice(0, 2000));
    await tx
      .update(s.agentApproval)
      .set({
        status,
        decidedById: actor.userId,
        decidedAt: new Date(),
        note,
      })
      .where(eq(s.agentApproval.id, approval.id));
    const name = await memberName(tx, actor.userId);
    const data = {
      requestId: approval.requestKey,
      approvalId: approval.id,
      title: approval.title,
      decision: input.decision,
      note,
      byId: actor.userId,
      byName: name,
    };
    const inputSequence = await addInput(
      tx,
      session,
      "approval_answer",
      data,
      actor.userId,
    );
    const [pending] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(s.agentApproval)
      .where(
        and(
          eq(s.agentApproval.sessionId, session.id),
          eq(s.agentApproval.status, "pending"),
        ),
      );
    const resume = (pending?.count ?? 0) === 0;
    if (resume) requireStep(agentSession, session.status, "resume");
    const eventSequence = await appendEvents(tx, session, [
      { type: "approval_answer", data },
      ...(resume
        ? [
            {
              type: "status" as const,
              data: { phase: "running", status: "running" },
            },
          ]
        : []),
    ]);
    const row = await updateSession(tx, session.id, {
      inputSequence,
      eventSequence,
      ...(resume ? { status: "running" as const } : {}),
    });
    await projectSession(tx, row);
    publish(threadEvent(row, "approval_answered", approval.id));
    return sessionEntity(row, []);
  });
}

// --------------------------------------------------------------- queries

async function readable(
  db: Database,
  actor: SessionActor,
  organizationId: string,
  sessionId: string,
) {
  await authorize(db, actor.userId, organizationId);
  const [session] = await db
    .select()
    .from(s.agentSession)
    .where(
      and(
        eq(s.agentSession.organizationId, organizationId),
        eq(s.agentSession.id, sessionId),
      ),
    );
  if (!session) throw notFound();
  assertAgentProject(actor.agent, session.projectId);
  return session;
}

export async function getSession(
  db: Database,
  actor: SessionActor,
  input: { organizationId: string; sessionId: string; events?: number },
) {
  const session = await readable(
    db,
    actor,
    input.organizationId,
    input.sessionId,
  );
  const approvals = await db
    .select()
    .from(s.agentApproval)
    .where(eq(s.agentApproval.sessionId, session.id));
  const events = await latestEvents(db, session.id, {
    limit: Math.min(input.events ?? 50, 200),
  });
  return {
    session: sessionEntity(session, approvals),
    events: events.map((e) => ({
      sequence: e.sequence,
      type: e.type,
      data: e.data,
      at: e.createdAt.toISOString(),
    })),
  };
}

export async function sessionEvents(
  db: Database,
  actor: SessionActor,
  input: {
    organizationId: string;
    sessionId: string;
    before?: number;
    limit?: number;
  },
) {
  const session = await readable(
    db,
    actor,
    input.organizationId,
    input.sessionId,
  );
  const events = await latestEvents(db, session.id, {
    limit: Math.min(input.limit ?? 100, 500),
    before: input.before,
  });
  return events.map((e) => ({
    sequence: e.sequence,
    type: e.type,
    data: e.data,
    at: e.createdAt.toISOString(),
  }));
}

export async function listSessions(
  db: Database,
  actor: SessionActor,
  input: {
    organizationId: string;
    status?: SessionStatus[];
    agentId?: string;
    workItemId?: string;
    limit?: number;
  },
) {
  await authorize(db, actor.userId, input.organizationId);
  const rows = await db
    .select()
    .from(s.agentSession)
    .where(
      and(
        eq(s.agentSession.organizationId, input.organizationId),
        input.status?.length
          ? inArray(s.agentSession.status, input.status)
          : undefined,
        input.agentId ? eq(s.agentSession.agentId, input.agentId) : undefined,
        input.workItemId
          ? eq(s.agentSession.workItemId, input.workItemId)
          : undefined,
        // A project-limited agent sees sessions of its projects only.
        actor.agent?.projectIds
          ? inArray(s.agentSession.projectId, [...actor.agent.projectIds])
          : undefined,
      ),
    )
    .orderBy(desc(s.agentSession.updatedAt))
    .limit(Math.min(input.limit ?? 50, 200));
  return rows.map((row) => sessionEntity(row, []));
}

// ----------------------------------------------------------- runner side

const leaseLost = () =>
  new DomainError(
    "conflict",
    "This runner no longer holds the session's lease. Stop working on it.",
    undefined,
    "lease_lost",
  );

// Locks the session and checks the runner's lease: a write with an older
// lease (or after the session ended) fails, and renews the lease otherwise.
async function leased(
  tx: Tx,
  runner: RunnerRow,
  sessionId: string,
  leaseToken: string,
  now: Date,
) {
  const session = await lockSession(tx, runner.organizationId, sessionId);
  if (
    session?.runnerId !== runner.id ||
    session.leaseToken !== leaseToken ||
    !ACTIVE.includes(session.status)
  )
    throw leaseLost();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_SECONDS * 1000);
  await tx
    .update(s.agentSession)
    .set({ leaseExpiresAt })
    .where(eq(s.agentSession.id, session.id));
  return { ...session, leaseExpiresAt };
}

function runnerHarnesses(runner: RunnerRow): HarnessId[] {
  return runner.harnesses
    .map((h) => h.id)
    .filter((id): id is HarnessId =>
      (harnessIds as readonly string[]).includes(id),
    );
}

// Claims the oldest queued session this runner may run, or null.
export async function claimSession(
  db: Database,
  runner: RunnerRow,
  now = new Date(),
): Promise<Assignment | null> {
  await recoverExpiredSessions(db, {
    now,
    organizationId: runner.organizationId,
  });
  const harnesses = runnerHarnesses(runner);
  if (!harnesses.length) return null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const outcome = await writeAndPublish(
      db,
      runner.organizationId,
      async (tx, publish) => {
        const [busy] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(s.agentSession)
          .where(
            and(
              eq(s.agentSession.runnerId, runner.id),
              inArray(s.agentSession.status, ["assigned", "running"]),
            ),
          );
        // Waiting sessions keep their lease without taking a slot.
        if ((busy?.count ?? 0) >= runner.maxSessions)
          return { done: true as const };
        const [candidate] = await tx
          .select({ session: s.agentSession, agent: s.agent })
          .from(s.agentSession)
          .innerJoin(s.agent, eq(s.agent.id, s.agentSession.agentId))
          .where(
            and(
              eq(s.agentSession.organizationId, runner.organizationId),
              eq(s.agentSession.status, "queued"),
              eq(s.agent.kind, "runner"),
              isNull(s.agent.archivedAt),
              inArray(s.agent.harness, harnesses),
              or(
                isNull(s.agentSession.requestedRunnerId),
                eq(s.agentSession.requestedRunnerId, runner.id),
              ),
              // A personal runner only runs its owner's agents.
              runner.ownerId ? eq(s.agent.ownerId, runner.ownerId) : undefined,
            ),
          )
          .orderBy(asc(s.agentSession.createdAt))
          .limit(1)
          .for("update", { of: s.agentSession, skipLocked: true });
        if (!candidate) return { done: true as const };
        const { session, agent } = candidate;
        const owner = await authorize(
          tx,
          agent.ownerId,
          agent.organizationId,
        ).catch(() => null);
        if (!owner) {
          // The agent cannot act any more; fail rather than retry forever.
          const eventSequence = await appendEvents(tx, session, [
            {
              type: "error",
              data: {
                message: `${agent.name}'s owner is no longer a member of the organization.`,
              },
            },
          ]);
          const row = await updateSession(tx, session.id, {
            status: "failed",
            error: `${agent.name}'s owner is no longer a member of the organization.`,
            eventSequence,
            completedAt: now,
          });
          await projectSession(tx, row);
          publish(threadEvent(row, "status"));
          return { done: false as const };
        }
        const leaseToken = randomBytes(24).toString("base64url");
        const leaseExpiresAt = new Date(now.getTime() + LEASE_SECONDS * 1000);
        await revokeSessionTokens(tx, session.id);
        const secret = `lct_${randomBytes(32).toString("base64url")}`;
        const [token] = await tx
          .insert(s.accessToken)
          .values({
            userId: agent.ownerId,
            name: agent.name,
            scope: agent.access,
            prefix: secret.slice(0, 10),
            tokenHash: createHash("sha256").update(secret).digest("hex"),
            agentId: agent.id,
            agentSessionId: session.id,
            expiresAt: new Date(now.getTime() + SESSION_TOKEN_MS),
          })
          .returning({ id: s.accessToken.id });
        const attemptNumber = session.attempts + 1;
        const eventSequence = await appendEvents(tx, session, [
          {
            type: "status",
            data: {
              phase: "assigned",
              status: "assigned",
              message: `${runner.name} claimed the session${attemptNumber > 1 ? ` (attempt ${attemptNumber} of ${session.maxAttempts})` : ""}.`,
              runnerId: runner.id,
              runnerName: runner.name,
              attempt: attemptNumber,
            },
          },
        ]);
        const row = await updateSession(tx, session.id, {
          status: "assigned",
          runnerId: runner.id,
          attempts: attemptNumber,
          leaseToken,
          leaseExpiresAt,
          runnerSequence: 0,
          eventSequence,
          accessTokenId: token!.id,
          assignedAt: now,
          error: null,
        });
        await projectSession(tx, row);
        publish(threadEvent(row, "status"));
        const [requester, item, ai] = await Promise.all([
          memberName(tx, session.requestedById),
          session.workItemId
            ? tx
                .select({
                  id: s.workItem.id,
                  number: s.workItem.number,
                  title: s.workItem.title,
                  key: s.project.key,
                })
                .from(s.workItem)
                .innerJoin(s.project, eq(s.project.id, s.workItem.projectId))
                .where(eq(s.workItem.id, session.workItemId))
                .then((r) => r[0])
            : undefined,
          aiPolicy(tx, session.organizationId),
        ]);
        const base = platformUrl().replace(/\/$/, "");
        const assignment: Assignment = {
          sessionId: row.id,
          leaseToken,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          attempt: attemptNumber,
          organizationId: row.organizationId,
          title: row.title,
          // The task, then what Lictory adds to it.
          prompt: row.context
            ? `${row.prompt}\n\n---\n${row.context}`
            : row.prompt,
          agent: {
            id: agent.id,
            name: agent.name,
            handle: agent.handle,
            harness: agent.harness as HarnessId,
            model: agent.model,
            instructions: agent.instructions,
            access: agent.access === "read" ? "read" : "write",
          },
          requestedBy: { id: session.requestedById, name: requester },
          workItem: item
            ? {
                id: item.id,
                key: `${item.key}-${item.number}`,
                title: item.title,
              }
            : null,
          repository: row.branch
            ? {
                url: row.repositoryUrl,
                baseBranch: row.baseBranch,
                branch: row.branch,
              }
            : null,
          lictory: { url: base, mcpUrl: `${base}/api/mcp`, token: secret },
          inputCursor: row.inputCursor,
          modelProxy: agent.harness === "lictory" && ai.enabled && ai.available,
        };
        return { done: true as const, assignment };
      },
    );
    if (outcome.done)
      return "assignment" in outcome ? (outcome.assignment ?? null) : null;
  }
  return null;
}

export async function startRun(
  db: Database,
  runner: RunnerRow,
  sessionId: string,
  leaseToken: string,
  now = new Date(),
) {
  return writeAndPublish(db, runner.organizationId, async (tx, publish) => {
    const session = await leased(tx, runner, sessionId, leaseToken, now);
    requireStep(agentSession, session.status, "start");
    if (session.status !== "assigned") return { status: session.status };
    const eventSequence = await appendEvents(tx, session, [
      { type: "status", data: { phase: "running", status: "running" } },
    ]);
    const row = await updateSession(tx, session.id, {
      status: "running",
      startedAt: now,
      eventSequence,
    });
    await projectSession(tx, row);
    publish(threadEvent(row, "status"));
    return { status: row.status };
  });
}

export class SequenceGap extends DomainError {
  constructor(readonly acked: number) {
    super(
      "conflict",
      `Events must continue after sequence ${acked}. Resend from there.`,
      undefined,
      "sequence_gap",
    );
  }
}

// Stores a batch of runner events. Idempotent by the runner's sequence:
// events at or below the stored one are already in the log and skipped.
export async function appendRunnerEvents(
  db: Database,
  runner: RunnerRow,
  sessionId: string,
  leaseToken: string,
  rawEvents: unknown[],
  now = new Date(),
) {
  if (rawEvents.length > limits.batchEvents)
    throw new DomainError(
      "validation",
      `Send at most ${limits.batchEvents} events per batch.`,
    );
  const events = rawEvents
    .map((raw) => runnerEventSchema.parse(raw) as RunnerEvent)
    .sort((a, b) => a.seq - b.seq);
  return writeAndPublish(db, runner.organizationId, async (tx, publish) => {
    const session = await leased(tx, runner, sessionId, leaseToken, now);
    const fresh = events.filter((e) => e.seq > session.runnerSequence);
    if (!fresh.length)
      return { acked: session.runnerSequence, status: session.status };
    let expected = session.runnerSequence + 1;
    for (const event of fresh) {
      if (event.seq !== expected) throw new SequenceGap(session.runnerSequence);
      expected++;
    }
    let status = session.status;
    let summary = session.resultSummary;
    const approvals: string[] = [];
    const stored: { type: RunnerEvent["type"]; data: unknown; at?: Date }[] =
      [];
    for (const event of fresh) {
      const at = event.at ? new Date(event.at) : now;
      // A runner clock far off is not trusted for ordering in the log.
      const when =
        Math.abs(at.getTime() - now.getTime()) < 10 * 60_000 ? at : now;
      if (event.type === "approval_request") {
        const data = event.data as {
          requestId: string;
          title: string;
          tool?: string;
          input?: unknown;
          reason?: string;
        };
        const id = crypto.randomUUID();
        const [inserted] = await tx
          .insert(s.agentApproval)
          .values({
            id,
            organizationId: session.organizationId,
            sessionId: session.id,
            requestKey: data.requestId,
            title: data.title,
            detail: boundEvent({
              tool: data.tool ?? null,
              input: data.input ?? null,
              reason: data.reason ?? null,
            }),
          })
          .onConflictDoNothing()
          .returning({ id: s.agentApproval.id });
        if (inserted) {
          approvals.push(inserted.id);
          stored.push({
            type: event.type,
            data: { ...data, approvalId: inserted.id },
            at: when,
          });
          if (status === "assigned" || status === "running") status = "waiting";
          continue;
        }
      }
      if (event.type === "summary")
        summary = String((event.data as { text: string }).text).slice(
          0,
          limits.text,
        );
      stored.push({ type: event.type, data: event.data, at: when });
    }
    // An approval request before the runner said it started still counts as
    // working: assigned → running → waiting.
    if (status === "waiting" && session.status !== "waiting") {
      if (session.status === "assigned")
        requireStep(agentSession, session.status, "start");
      else requireStep(agentSession, session.status, "wait");
    }
    // The agent's answers to people reach the session's thread: the first
    // message after a person's steering message (the full log stays in the
    // Factory). Everything else (progress, tool calls) stays in the log.
    const replies: number[] = [];
    if (session.channelId && stored.some((e) => e.type === "message")) {
      const [last] = await tx
        .select({
          type: s.agentSessionEvent.type,
          sequence: s.agentSessionEvent.sequence,
        })
        .from(s.agentSessionEvent)
        .where(
          and(
            eq(s.agentSessionEvent.sessionId, session.id),
            inArray(s.agentSessionEvent.type, ["message", "user_message"]),
          ),
        )
        .orderBy(desc(s.agentSessionEvent.sequence))
        .limit(1);
      // The task is the session's first event (a person's message or the
      // policy's context); the session card already answers it, so only a
      // later steering message awaits an answer.
      let awaiting = last?.type === "user_message" && last.sequence > 1;
      stored.forEach((event, index) => {
        if (event.type !== "message") return;
        if (awaiting) replies.push(session.eventSequence + 1 + index);
        awaiting = false;
      });
    }
    const eventSequence = await appendEvents(tx, session, [
      ...stored,
      ...(status !== session.status
        ? [{ type: "status" as const, data: { phase: status, status } }]
        : []),
    ]);
    const row = await updateSession(tx, session.id, {
      runnerSequence: fresh.at(-1)!.seq,
      eventSequence,
      status,
      resultSummary: summary,
      ...(status !== session.status && session.status === "assigned"
        ? { startedAt: now }
        : {}),
    });
    await projectSession(tx, row);
    if (approvals.length) {
      // Asks the person who started it and the agent's owner.
      const agent = await agentOf(tx, row);
      const asked = await tx
        .select()
        .from(s.agentApproval)
        .where(inArray(s.agentApproval.id, approvals));
      await queueNotifications(
        tx,
        row.organizationId,
        asked.map((approval) => ({
          userIds: [row.requestedById, agent.ownerId],
          kind: "agent_approval_requested" as const,
          actorId: null,
          detail: {
            sessionId: row.id,
            approvalId: approval.id,
            question: approval.title,
            sessionTitle: row.title,
            agentName: agent.name,
          },
          dedupeKey: `agent-approval:${approval.id}`,
        })),
      );
    }
    for (const approvalId of approvals)
      publish(threadEvent(row, "approval_requested", approvalId));
    for (const sequence of replies)
      publish({
        ...threadEvent(row, "agent_message"),
        eventSequence: sequence,
      });
    return { acked: row.runnerSequence, status: row.status };
  });
}

// Steering inputs after `after` for the runner holding the lease.
export async function readInputs(
  db: Database,
  runner: RunnerRow,
  sessionId: string,
  leaseToken: string,
  after: number,
  now = new Date(),
) {
  return factoryWrite(db, runner.organizationId, async (tx) => {
    const session = await leased(tx, runner, sessionId, leaseToken, now);
    const rows = await tx
      .select()
      .from(s.agentSessionInput)
      .where(
        and(
          eq(s.agentSessionInput.sessionId, session.id),
          gt(
            s.agentSessionInput.sequence,
            Math.max(after, session.inputCursor),
          ),
        ),
      )
      .orderBy(asc(s.agentSessionInput.sequence))
      .limit(100);
    return {
      status: session.status,
      inputs: rows.map((r): SessionInput => ({
        seq: r.sequence,
        kind: r.kind as SessionInput["kind"],
        at: r.createdAt.toISOString(),
        data: r.data,
      })),
    };
  });
}

// The runner's lease is valid, without writing anything (used before the
// long-poll waits).
export async function sessionStatusForRunner(
  db: Database,
  runner: RunnerRow,
  sessionId: string,
) {
  const [row] = await db
    .select({
      status: s.agentSession.status,
      inputSequence: s.agentSession.inputSequence,
      runnerId: s.agentSession.runnerId,
    })
    .from(s.agentSession)
    .where(
      and(
        eq(s.agentSession.organizationId, runner.organizationId),
        eq(s.agentSession.id, sessionId),
      ),
    );
  return row?.runnerId === runner.id ? row : undefined;
}

export async function completeRun(
  db: Database,
  runner: RunnerRow,
  sessionId: string,
  body: {
    leaseToken: string;
    outcome: "completed" | "failed";
    summary?: string;
    error?: string;
    branch?: string;
    lastSeq: number;
  },
  now = new Date(),
) {
  let pushed: SessionCompletion | undefined;
  const result = await writeAndPublish(
    db,
    runner.organizationId,
    async (tx, publish) => {
      const session = await leased(tx, runner, sessionId, body.leaseToken, now);
      if (body.lastSeq !== session.runnerSequence)
        throw new SequenceGap(session.runnerSequence);
      requireStep(agentSession, session.status, "finish");
      if (body.branch && !branchShape.test(body.branch))
        throw new DomainError("validation", "That branch name is not valid.");
      const summary =
        body.summary?.slice(0, limits.text) ?? session.resultSummary;
      const error =
        body.outcome === "failed"
          ? (body.error?.slice(0, 4000) ?? "The agent stopped with an error.")
          : null;
      const eventSequence = await appendEvents(tx, session, [
        ...(body.summary && body.summary !== session.resultSummary
          ? [{ type: "summary" as const, data: { text: body.summary } }]
          : []),
        {
          type: "status",
          data: {
            phase: body.outcome,
            status: body.outcome,
            ...(error ? { message: error } : {}),
          },
        },
      ]);
      await endRun(tx, session);
      const row = await updateSession(tx, session.id, {
        status: body.outcome,
        resultSummary: summary,
        error,
        branch: body.branch ?? session.branch,
        eventSequence,
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: now,
      });
      await projectSession(tx, row);
      await notifyFinished(tx, row);
      publish(threadEvent(row, "status"));
      if (row.status === "completed" && body.branch) {
        const agent = await agentOf(tx, row);
        pushed = {
          organizationId: row.organizationId,
          sessionId: row.id,
          agentId: row.agentId,
          ownerId: agent?.ownerId ?? row.requestedById,
          agentName: agent?.name ?? "An agent",
          agentHandle: agent?.handle ?? "agent",
          requestedById: row.requestedById,
          projectId: row.projectId,
          workItemId: row.workItemId,
          repositoryId: row.repositoryId,
          repositoryUrl: row.repositoryUrl,
          baseBranch: row.baseBranch,
          branch: body.branch,
          title: row.title,
          summary: row.resultSummary,
          attempt: row.attempts,
        };
      }
      return sessionEntity(row, []);
    },
  );
  // After commit: the branch becomes a code pull request (Code module).
  if (pushed) await sessionPushed(pushed);
  return result;
}

// A runner shutting down hands a session back at once instead of letting
// its lease expire. The attempt is given back: nothing failed.
export async function releaseRun(
  db: Database,
  runner: RunnerRow,
  sessionId: string,
  leaseToken: string,
  now = new Date(),
) {
  return writeAndPublish(db, runner.organizationId, async (tx, publish) => {
    const session = await leased(tx, runner, sessionId, leaseToken, now);
    requireStep(agentSession, session.status, "requeue");
    const eventSequence = await appendEvents(tx, session, [
      {
        type: "status",
        data: {
          phase: "requeued",
          status: "queued",
          message: `${runner.name} shut down; the session is queued again.`,
        },
      },
    ]);
    await endRun(tx, session);
    const row = await updateSession(tx, session.id, {
      status: "queued",
      runnerId: null,
      attempts: Math.max(0, session.attempts - 1),
      leaseToken: null,
      leaseExpiresAt: null,
      runnerSequence: 0,
      eventSequence,
      assignedAt: null,
      startedAt: null,
    });
    await projectSession(tx, row);
    await signalFactory(tx, { organizationId: row.organizationId });
    publish(threadEvent(row, "status"));
    return { status: row.status };
  });
}

// The session's repository, with credentials when the code host integration
// brokers them (ports.ts).
export async function sessionWorkspace(
  db: Database,
  runner: RunnerRow,
  sessionId: string,
  leaseToken: string,
  now = new Date(),
) {
  const { session, ownerId } = await factoryWrite(
    db,
    runner.organizationId,
    async (tx) => {
      const session = await leased(tx, runner, sessionId, leaseToken, now);
      return { session, ownerId: (await agentOf(tx, session)).ownerId };
    },
  );
  const repository = await resolveSessionWorkspace({ ...session, ownerId });
  return { repository };
}

// The Code module chose the repository a session works in (its workspace
// resolver): recorded on the session so its pull request opens there, and
// kept once set.
export async function recordSessionRepository(
  db: Database,
  organizationId: string,
  sessionId: string,
  repositoryId: string,
) {
  await factoryWrite(db, organizationId, async (tx) => {
    const session = await lockSession(tx, organizationId, sessionId);
    if (!session || session.repositoryId === repositoryId) return;
    if (session.repositoryId) return;
    const row = await updateSession(tx, session.id, { repositoryId });
    await projectSession(tx, row);
  });
}

// Lictory could not open the pull request a completed session's branch
// should become (the owner lost access to the project's code, the
// repository stopped serving it): the session's log and thread say why, once
// per attempt. The branch stays pushed.
export async function recordSessionPullRequestRefused(
  db: Database,
  organizationId: string,
  sessionId: string,
  reason: string,
) {
  const event = await factoryWrite(db, organizationId, async (tx) => {
    const session = await lockSession(tx, organizationId, sessionId);
    if (!session) return null;
    const key = `pull-request-refused:${session.attempts}`;
    const [seen] = await tx
      .select({ sequence: s.agentSessionEvent.sequence })
      .from(s.agentSessionEvent)
      .where(
        and(
          eq(s.agentSessionEvent.sessionId, session.id),
          eq(s.agentSessionEvent.type, "error"),
          sql`${s.agentSessionEvent.data}->>'key' = ${key}`,
        ),
      );
    if (seen) return null;
    const message = `Lictory could not open a pull request for ${session.branch ?? "the session's branch"}: ${reason} The branch is pushed; open the pull request on the code host, or fix access and retry the session.`;
    const sequence = await appendEvents(tx, session, [
      { type: "error", data: { message, key } },
    ]);
    const row = await updateSession(tx, session.id, {
      eventSequence: sequence,
    });
    await projectSession(tx, row);
    return { ...threadEvent(row, "pull_request_refused"), reason: message };
  });
  if (event) await publishSessionEvent(event);
}

// After the pull request was recorded: the session's thread shows it (its
// card and the agent's message).
export async function publishSessionPullRequest(
  db: Database,
  organizationId: string,
  sessionId: string,
  pullRequest: { number: number; title: string; url: string },
) {
  const [row] = await db
    .select()
    .from(s.agentSession)
    .where(
      and(
        eq(s.agentSession.organizationId, organizationId),
        eq(s.agentSession.id, sessionId),
      ),
    );
  if (!row?.pullRequestId) return;
  await publishSessionEvent({
    ...threadEvent(row, "pull_request"),
    pullRequest,
  });
}

// The code pull request the session's branch became (Code's outbox, in its
// transaction: it holds the organization lock exclusively, so no Factory
// writer runs). The session's projection shows it; the first one stays.
export async function recordSessionPullRequest(
  tx: Tx,
  input: {
    organizationId: string;
    sessionId: string;
    pullRequestId: string;
    url: string;
    title: string;
    number: number;
  },
) {
  const session = await lockSession(tx, input.organizationId, input.sessionId);
  if (!session || session.pullRequestId) return null;
  const eventSequence = await appendEvents(tx, session, [
    {
      type: "status",
      data: {
        phase: "pull_request",
        status: session.status,
        message: `Opened pull request #${input.number}: ${input.title}`,
        url: input.url,
        pullRequestId: input.pullRequestId,
      },
    },
  ]);
  const row = await updateSession(tx, session.id, {
    pullRequestId: input.pullRequestId,
    pullRequestUrl: input.url,
    eventSequence,
  });
  await projectSession(tx, row);
  return threadEvent(row, "pull_request");
}

// The model proxy may serve this lease: the session is running, its agent
// uses the built-in harness and Lictory Intelligence is enabled.
export async function modelAccess(
  db: Database,
  runner: RunnerRow,
  sessionId: string,
  leaseToken: string,
  now = new Date(),
) {
  return factoryWrite(db, runner.organizationId, async (tx) => {
    const session = await leased(tx, runner, sessionId, leaseToken, now);
    if (session.status !== "running")
      throw new DomainError(
        "conflict",
        `The model is available only while the session is running; it is ${session.status}.`,
        undefined,
        "invalid_state",
      );
    const agent = await agentOf(tx, session);
    if (agent.harness !== "lictory")
      throw new DomainError(
        "forbidden",
        "Only the built-in harness uses Lictory's model proxy.",
      );
    const ai = await aiPolicy(tx, session.organizationId);
    if (!ai.available)
      throw new DomainError(
        "unavailable",
        "This server has no AI provider configured, so the built-in harness cannot run.",
      );
    if (!ai.enabled)
      throw new DomainError(
        "forbidden",
        "Lictory Intelligence is turned off for this organization. An administrator can turn it on in Settings → Intelligence.",
        undefined,
        "ai_disabled",
      );
    return { organizationId: session.organizationId, sessionId: session.id };
  });
}

// --------------------------------------------------------------- recovery

// Sessions whose runner stopped renewing the lease return to the queue, or
// fail once their attempts are used up. Safe to run concurrently (rows are
// claimed with SKIP LOCKED) and bounded per call.
export async function recoverExpiredSessions(
  db: Database,
  options: { now?: Date; organizationId?: string; limit?: number } = {},
) {
  const now = options.now ?? new Date();
  const candidates = await db
    .select({
      id: s.agentSession.id,
      organizationId: s.agentSession.organizationId,
    })
    .from(s.agentSession)
    .where(
      and(
        inArray(s.agentSession.status, ACTIVE),
        lt(s.agentSession.leaseExpiresAt, now),
        options.organizationId
          ? eq(s.agentSession.organizationId, options.organizationId)
          : undefined,
      ),
    )
    .limit(options.limit ?? 20);
  const outcome = { requeued: 0, failed: 0 };
  for (const candidate of candidates) {
    await writeAndPublish(db, candidate.organizationId, async (tx, publish) => {
      const [session] = await tx
        .select()
        .from(s.agentSession)
        .where(
          and(
            eq(s.agentSession.id, candidate.id),
            inArray(s.agentSession.status, ACTIVE),
            lt(s.agentSession.leaseExpiresAt, now),
          ),
        )
        .for("update", { skipLocked: true });
      if (!session) return;
      requireStep(agentSession, session.status, "requeue");
      const exhausted = session.attempts >= session.maxAttempts;
      const message = exhausted
        ? `The runner stopped responding ${session.attempts} times; the session failed. Retry it when a runner is available.`
        : `The runner stopped responding; the session is queued again (attempt ${session.attempts} of ${session.maxAttempts} used).`;
      const eventSequence = await appendEvents(tx, session, [
        {
          type: "status",
          data: {
            phase: exhausted ? "failed" : "requeued",
            status: exhausted ? "failed" : "queued",
            message,
          },
        },
      ]);
      await endRun(tx, session);
      const row = await updateSession(tx, session.id, {
        status: exhausted ? "failed" : "queued",
        runnerId: exhausted ? session.runnerId : null,
        leaseToken: null,
        leaseExpiresAt: null,
        runnerSequence: 0,
        eventSequence,
        error: exhausted ? message : null,
        ...(exhausted
          ? { completedAt: now }
          : { assignedAt: null, startedAt: null }),
      });
      await projectSession(tx, row);
      if (exhausted) await notifyFinished(tx, row);
      else await signalFactory(tx, { organizationId: row.organizationId });
      publish(threadEvent(row, "status"));
      outcome[exhausted ? "failed" : "requeued"]++;
    });
  }
  return outcome;
}

// Sessions waiting on this person: approval requests they may answer.
export async function waitingOn(
  db: Database,
  userId: string,
  organizationId: string,
) {
  await authorize(db, userId, organizationId);
  const rows = await db
    .select({ session: s.agentSession, approval: s.agentApproval })
    .from(s.agentApproval)
    .innerJoin(s.agentSession, eq(s.agentSession.id, s.agentApproval.sessionId))
    .innerJoin(s.agent, eq(s.agent.id, s.agentSession.agentId))
    .where(
      and(
        eq(s.agentApproval.organizationId, organizationId),
        eq(s.agentApproval.status, "pending"),
        or(
          eq(s.agentSession.requestedById, userId),
          eq(s.agent.ownerId, userId),
        ),
      ),
    )
    .orderBy(asc(s.agentApproval.createdAt))
    .limit(100);
  return rows.map(({ session, approval }) => ({
    sessionId: session.id,
    title: session.title,
    approvalId: approval.id,
    question: approval.title,
    askedAt: approval.createdAt.toISOString(),
  }));
}
