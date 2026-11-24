import type { Actor, Tx } from "@lictory/core/domain/service";

// The agent registry is its own module (Factory). Channels store agents by
// id and reach that registry only through this port, so chat works with no
// agent configured and the Factory can register its directory when it
// loads. The default directory knows no agents: agent mentions are left as
// text and every agent-surface call is authored by the person (with `via`).

export type ChannelAgent = {
  id: string;
  // Mention handle, unique in the organization (`forge`).
  handle: string;
  name: string;
  // The accountable person the agent acts for.
  ownerId: string;
  avatarUrl?: string | null;
};

export type AgentMentionEvent = {
  organizationId: string;
  channelId: string;
  messageId: string;
  threadRootId: string | null;
  agentIds: string[];
  // Who wrote the message (the person, or the person an agent acts for).
  mentionedById: string;
  // `user` with no `via`: the person wrote it themselves. An agent's
  // message, or a person's sent through a token or Litto, says so.
  authorKind: "user" | "agent";
  via: string | null;
  body: string;
};

// A reply in a thread, for the Factory to steer the agent session whose
// thread it is. Same transaction rules as `mentioned`.
export type ThreadReplyEvent = {
  organizationId: string;
  channelId: string;
  messageId: string;
  threadRootId: string;
  authorKind: "user" | "agent";
  // The person (or the person an agent acts for).
  authorUserId: string;
  via: string | null;
  body: string;
  // The reply also mentions these agents (handled by `mentioned`).
  agentIds: string[];
};

export interface AgentDirectory {
  /** Agents of the organization with these ids; unknown ids are left out. */
  agents(
    tx: Tx,
    organizationId: string,
    ids: readonly string[],
  ): Promise<ChannelAgent[]>;
  /** Agents whose handle starts with `prefix`, for the mention picker. */
  search(
    tx: Tx,
    organizationId: string,
    prefix: string,
    limit: number,
  ): Promise<ChannelAgent[]>;
  /**
   * The registered agent an authenticated call executes as (an MCP token
   * bound to an agent identity, a runner session), or null when the call is
   * the person's own or an unregistered delegation (Litto, a plain token).
   */
  actingAgent(
    tx: Tx,
    organizationId: string,
    actor: Actor,
  ): Promise<ChannelAgent | null>;
  /**
   * Called inside the message's transaction when it mentions agents, so the
   * Factory can queue work (an agent session answering in the thread). It
   * must only write rows; external calls happen after commit in the worker.
   * Text is information, never permission: what an agent then does is
   * authorized by its own capabilities.
   */
  mentioned?(tx: Tx, event: AgentMentionEvent): Promise<void>;
  /**
   * Called inside the reply's transaction for every thread reply, before
   * `mentioned`. Replies are conversation: only what the Factory decides
   * (the session's requester or the agent's owner writing themselves)
   * reaches an agent, as a steering message.
   */
  replied?(tx: Tx, event: ThreadReplyEvent): Promise<void>;
  /**
   * Whether this person may address (start work for) this agent: the
   * Factory's rule is an active agent the person owns, or a shared one.
   * Consulted for messages from linked external channels (Slack), where a
   * mention only reaches the agent when its author maps to such a person.
   * Without it, only the agent's owner may address it.
   */
  mayAddress?(
    tx: Tx,
    organizationId: string,
    userId: string,
    agent: Pick<ChannelAgent, "id" | "ownerId">,
  ): Promise<boolean>;
}

/**
 * Whether this person may address the agent (the directory's rule; without
 * one, only its owner). A mention by anyone else stays text: it neither
 * starts work nor wakes the agent through its person's event feed.
 */
export async function mayAddressAgent(
  tx: Tx,
  organizationId: string,
  userId: string,
  agent: Pick<ChannelAgent, "id" | "ownerId">,
): Promise<boolean> {
  const directory = agentDirectory();
  return directory.mayAddress
    ? directory.mayAddress(tx, organizationId, userId, agent)
    : agent.ownerId === userId;
}

/** The agent a person may address by handle, or null (text stays text). */
export async function addressableAgent(
  tx: Tx,
  organizationId: string,
  userId: string,
  handle: string,
): Promise<ChannelAgent | null> {
  const directory = agentDirectory();
  const normalized = handle.toLowerCase();
  const agent = (
    await directory.search(tx, organizationId, normalized, 10)
  ).find((a) => a.handle.toLowerCase() === normalized);
  if (!agent) return null;
  return (await mayAddressAgent(tx, organizationId, userId, agent))
    ? agent
    : null;
}

const noAgents: AgentDirectory = {
  agents: async () => [],
  search: async () => [],
  actingAgent: async () => null,
};

let current: AgentDirectory = noAgents;

/** Installs the organization agent registry (the Factory module). */
export function registerAgentDirectory(directory: AgentDirectory) {
  current = directory;
}

export function agentDirectory(): AgentDirectory {
  return current;
}
