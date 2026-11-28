import { z } from "zod";
import {
  defineCapability,
  everywhere,
  id,
  organizationId,
  webOnly,
  type AnyCapability,
  type CapabilityContext,
} from "@lictory/core/capabilities/core";
import { agentSession } from "@lictory/core/contracts/state-machines";
import {
  createAgent,
  createAgentToken,
  listAgentActivity,
  listAgentTokens,
  listAgents,
  revokeAgentToken,
  setAgentArchived,
  updateAgent,
} from "@lictory/core/factory/agents";
import { assertPerson } from "@lictory/core/factory/authority";
import { harnessIds } from "@lictory/core/factory/protocol";
import {
  createRunnerRegistration,
  listRunners,
  revokeRunner,
} from "@lictory/core/factory/runners";
import {
  answerApproval,
  cancelSession,
  getSession,
  interruptSession,
  listSessions,
  retrySession,
  sendSessionMessage,
  sessionEvents,
  startSession,
  waitingOn,
} from "@lictory/core/factory/sessions";

// The Factory's capabilities (docs/internals/factory.md): agents, runners
// and agent sessions. People manage agents, runners and credentials in the
// browser; starting, steering and reading sessions is available to agents
// too. Domain services authorize every call (membership, ownership, the
// calling agent's scope).

const actor = (ctx: CapabilityContext) => ({
  userId: ctx.principal.userId,
  agent: ctx.principal.agent ?? null,
});

const agentsWhere = "Factory → Agents";
const connectionWhere = "Factory → Agents → the agent's Connection";
const runnersWhere = "Factory → Runners";
const sessionId = id.describe("Agent session id (see listAgentSessions).");
const agentId = id.describe("Agent id (see listAgents).");

const handle = z
  .string()
  .trim()
  .min(3)
  .max(31)
  .describe("Mention handle without @: lowercase letters, digits and _.");
const agentFields = {
  name: z.string().trim().min(1, "Name the agent.").max(60),
  handle,
  description: z.string().max(500).optional(),
  avatar: z.string().max(40).nullable().optional(),
  harness: z.enum(harnessIds).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  instructions: z.string().max(8000).optional(),
  access: z.enum(["read", "write"]),
  projectIds: z.array(id).max(50).nullable().optional(),
  shared: z.boolean().optional(),
  defaultRunnerId: id.nullable().optional(),
};

const listAgentsCapability = defineCapability({
  name: "listAgents",
  title: "List agents",
  description:
    "The organization's agents: name, @handle, owner (the accountable person), kind (runner agents run a harness on a runner; external agents are MCP clients with their own token), harness and model, scope (read or write, optional project allowlist) and whether other members may start sessions with it.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId, includeArchived: z.boolean().optional() }),
  async run(ctx, input) {
    return {
      agents: await listAgents(
        ctx.db,
        ctx.principal.userId,
        input.organizationId,
        input,
      ),
    };
  },
});

const createAgentCapability = defineCapability({
  name: "createAgent",
  title: "Create agent",
  description:
    "Create an agent you own. It acts with your permissions narrowed by its scope and is shown as acting via you.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "membership", where: agentsWhere },
  input: z.object({
    organizationId,
    agentId: z.uuid().optional(),
    kind: z.enum(["runner", "external"]),
    ...agentFields,
  }),
  async run(ctx, { organizationId, agentId, ...input }) {
    const agent = await createAgent(
      ctx.db,
      ctx.principal.userId,
      organizationId,
      input,
      agentId,
    );
    ctx.effects.track("agent_created", {
      kind: agent.kind,
      harness: agent.harness,
    });
    return { agent };
  },
});

const updateAgentCapability = defineCapability({
  name: "updateAgent",
  title: "Update agent",
  description:
    "Change an agent you own: its name, handle, harness, model, instructions or scope.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "membership", where: agentsWhere },
  idempotent: true,
  input: z.object({
    organizationId,
    agentId,
    ...z.object(agentFields).partial().shape,
  }),
  async run(ctx, { organizationId, agentId, ...changes }) {
    return {
      agent: await updateAgent(
        ctx.db,
        ctx.principal.userId,
        organizationId,
        agentId,
        changes,
      ),
    };
  },
});

const archiveAgentCapability = defineCapability({
  name: "setAgentArchived",
  title: "Archive or restore agent",
  description:
    "Archive an agent (its tokens stop working, its history stays) or restore it. Its owner or an organization administrator.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "membership", where: agentsWhere },
  idempotent: true,
  input: z.object({ organizationId, agentId, archived: z.boolean() }),
  async run(ctx, input) {
    return {
      agent: await setAgentArchived(
        ctx.db,
        ctx.principal.userId,
        input.organizationId,
        input.agentId,
        input.archived,
      ),
    };
  },
});

const listAgentActivityCapability = defineCapability({
  name: "listAgentActivity",
  title: "List agent activity",
  description:
    "What an agent you own did, newest first: each tool it called with one of its tokens, when, the subject it named (a work item key, a session id…), whether it succeeded and, when refused, the refusal it got. Inputs are not recorded.",
  kind: "query",
  surfaces: webOnly,
  humanOnly: {
    reason: "audit",
    where: "Factory → Agents → the agent → Recent activity",
  },
  input: z.object({
    organizationId,
    agentId,
    limit: z.number().int().min(1).max(100).optional(),
  }),
  async run(ctx, input) {
    return {
      calls: await listAgentActivity(
        ctx.db,
        ctx.principal.userId,
        input.organizationId,
        input,
      ),
    };
  },
});

const listAgentTokensCapability = defineCapability({
  name: "listAgentTokens",
  title: "List agent tokens",
  description: "Access tokens of an agent you own.",
  kind: "query",
  surfaces: webOnly,
  humanOnly: { reason: "credentials", where: connectionWhere },
  input: z.object({ organizationId, agentId }),
  async run(ctx, input) {
    return {
      tokens: await listAgentTokens(
        ctx.db,
        ctx.principal.userId,
        input.organizationId,
        input.agentId,
      ),
    };
  },
});

const createAgentTokenCapability = defineCapability({
  name: "createAgentToken",
  title: "Create agent token",
  description:
    "Create an access token for an agent you own, for its MCP client. The secret is returned once.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "credentials", where: connectionWhere },
  input: z.object({
    organizationId,
    agentId,
    expiresInDays: z
      .union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)])
      .nullable(),
  }),
  async run(ctx, { organizationId, ...input }) {
    const result = await createAgentToken(
      ctx.db,
      ctx.principal.userId,
      organizationId,
      input,
    );
    ctx.effects.track("agent_token_created", {});
    return result;
  },
});

const revokeAgentTokenCapability = defineCapability({
  name: "revokeAgentToken",
  title: "Revoke agent token",
  description: "Revoke an agent's access token immediately.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "credentials", where: connectionWhere },
  destructive: true,
  idempotent: true,
  input: z.object({ organizationId, agentId, tokenId: id }),
  async run(ctx, { organizationId, ...input }) {
    return {
      token: await revokeAgentToken(
        ctx.db,
        ctx.principal.userId,
        organizationId,
        input,
      ),
    };
  },
});

const listRunnersCapability = defineCapability({
  name: "listRunners",
  title: "List runners",
  description:
    "Machines that execute agent sessions: name, organization or personal (personal runners only run their owner's agents), operating system, detected harnesses, isolation (host or container), session capacity and last heartbeat.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId }),
  async run(ctx, input) {
    return {
      runners: await listRunners(
        ctx.db,
        ctx.principal.userId,
        input.organizationId,
      ),
    };
  },
});

const createRunnerRegistrationCapability = defineCapability({
  name: "createRunnerRegistration",
  title: "Create runner registration token",
  description:
    "A one-time token, valid for an hour, that `lictory-runner register` exchanges for a runner credential. Organization runners need an administrator; personal runners only run your own agents.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "credentials", where: runnersWhere },
  input: z.object({ organizationId, personal: z.boolean() }),
  async run(ctx, input) {
    assertPerson(ctx.principal.agent, "adding a runner");
    return createRunnerRegistration(
      ctx.db,
      ctx.principal.userId,
      input.organizationId,
      input,
    );
  },
});

const revokeRunnerCapability = defineCapability({
  name: "revokeRunner",
  title: "Revoke runner",
  description:
    "Revoke a runner's credential at once. Sessions it holds return to the queue.",
  kind: "command",
  surfaces: webOnly,
  humanOnly: { reason: "credentials", where: runnersWhere },
  destructive: true,
  idempotent: true,
  input: z.object({ organizationId, runnerId: id }),
  async run(ctx, input) {
    return {
      runner: await revokeRunner(
        ctx.db,
        ctx.principal.userId,
        input.organizationId,
        input.runnerId,
      ),
    };
  },
});

const sessionStatuses = Object.keys(agentSession.states) as [
  keyof typeof agentSession.states,
  ...(keyof typeof agentSession.states)[],
];

const listSessionsCapability = defineCapability({
  name: "listAgentSessions",
  title: "List agent sessions",
  description: `Agent sessions, most recently updated first. Each has a status: ${Object.entries(
    agentSession.states,
  )
    .map(([state, meaning]) => `${state} (${meaning})`)
    .join("; ")}`,
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    status: z
      .array(z.enum(sessionStatuses))
      .optional()
      .describe("Only sessions in these statuses."),
    agentId: agentId.optional(),
    workItemId: id.optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  async run(ctx, input) {
    return { sessions: await listSessions(ctx.db, actor(ctx), input) };
  },
});

const getSessionCapability = defineCapability({
  name: "getAgentSession",
  title: "Get agent session",
  description:
    "One agent session with its pending approval requests and its latest events (messages, tool calls, commands, file changes, status). Completed is a claim, not proof: delivery evidence is the merged pull request and checks.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    sessionId,
    events: z
      .number()
      .int()
      .min(0)
      .max(200)
      .optional()
      .describe("How many of the latest events to include (default 50)."),
  }),
  run: (ctx, input) => getSession(ctx.db, actor(ctx), input),
});

const sessionEventsCapability = defineCapability({
  name: "listAgentSessionEvents",
  title: "List agent session events",
  description:
    "A window of a session's event log, oldest first. Pass `before` (a sequence) to read earlier events.",
  kind: "query",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    sessionId,
    before: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Read the events before this sequence (the first sequence of the window you have); omitted: the latest events.",
      ),
    limit: z.number().int().min(1).max(500).optional(),
  }),
  async run(ctx, input) {
    return { events: await sessionEvents(ctx.db, actor(ctx), input) };
  },
});

const waitingCapability = defineCapability({
  name: "listAgentApprovalsWaiting",
  title: "List approval requests waiting on me",
  description:
    "Questions agent sessions asked that you may answer (you started the session or own the agent).",
  kind: "query",
  surfaces: everywhere,
  input: z.object({ organizationId }),
  async run(ctx, input) {
    return {
      approvals: await waitingOn(
        ctx.db,
        ctx.principal.userId,
        input.organizationId,
      ),
    };
  },
});

const startSessionCapability = defineCapability({
  name: "startAgentSession",
  title: "Start agent session",
  description:
    "Ask a runner agent to work on a task. It is queued until a runner that may run the agent claims it. `prompt` says what to do; `workItemId` names the work item (its key becomes the default branch); `repositoryUrl` (https or ssh, no credentials) and `baseBranch` say where the code is. You need to own the agent or the agent must be shared. With `channelId` (and optionally `threadRootMessageId`) the session's live card, its approval requests and the agent's answers are posted in that thread, and replies there by you or the agent's owner steer it; you must be able to post in the channel. Retrying with the same `mutationId` returns the same session.",
  kind: "command",
  surfaces: everywhere,
  idempotent: true,
  input: z.object({
    organizationId,
    agentId,
    prompt: z.string().min(1).max(20_000).describe("What the agent should do."),
    title: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Session title; omitted: the work item's title or the prompt's first line.",
      ),
    workItemId: id.nullable().optional(),
    repositoryUrl: z
      .string()
      .max(500)
      .nullable()
      .optional()
      .describe(
        "Repository to work in (https or ssh, no credentials in the URL).",
      ),
    baseBranch: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe(
        "Branch to start from; omitted: the repository's default branch.",
      ),
    branch: z
      .string()
      .max(200)
      .nullable()
      .optional()
      .describe(
        "Branch the agent works on; omitted: derived from the work item key, or the agent's handle.",
      ),
    runnerId: id
      .nullable()
      .optional()
      .describe(
        "Runner to run on (listRunners); omitted: the agent's default runner, or any runner that may run it.",
      ),
    channelId: id.nullable().optional(),
    threadRootMessageId: id
      .nullable()
      .optional()
      .describe(
        "Message whose thread in channelId the session posts in; omitted: a new thread.",
      ),
    mutationId: z
      .uuid()
      .optional()
      .describe(
        "Idempotency key. Retrying with the same value returns the same session.",
      ),
  }),
  async run(ctx, input) {
    const session = await startSession(ctx.db, actor(ctx), input);
    ctx.effects.track("agent_session_started", {
      with_work_item: Boolean(input.workItemId),
    });
    return { session };
  },
});

const sendMessageCapability = defineCapability({
  name: "sendAgentSessionMessage",
  title: "Send message to agent session",
  description: `Send a steering message to the agent of a session you started or whose agent you own. ${agentSession.rule("sendMessage")}`,
  kind: "command",
  surfaces: everywhere,
  input: z.object({
    organizationId,
    sessionId,
    text: z.string().min(1).max(8000).describe("The message to the agent."),
  }),
  run: (ctx, input) => sendSessionMessage(ctx.db, actor(ctx), input),
});

const interruptCapability = defineCapability({
  name: "interruptAgentSession",
  title: "Interrupt agent session",
  description: `Stop the agent's current turn; it waits for your next message. ${agentSession.rule("interrupt")}`,
  kind: "command",
  surfaces: everywhere,
  input: z.object({ organizationId, sessionId }),
  async run(ctx, input) {
    return { session: await interruptSession(ctx.db, actor(ctx), input) };
  },
});

const cancelCapability = defineCapability({
  name: "cancelAgentSession",
  title: "Cancel agent session",
  description: `Stop a session for good (it can be retried). The person who started it, the agent's owner or an organization administrator. ${agentSession.rule("cancel")}`,
  kind: "command",
  surfaces: everywhere,
  destructive: true,
  idempotent: true,
  input: z.object({ organizationId, sessionId }),
  async run(ctx, input) {
    return { session: await cancelSession(ctx.db, actor(ctx), input) };
  },
});

const retryCapability = defineCapability({
  name: "retryAgentSession",
  title: "Retry agent session",
  description: `Queue the session again from its original instructions; its history stays. ${agentSession.rule("retry")}`,
  kind: "command",
  surfaces: everywhere,
  input: z.object({ organizationId, sessionId }),
  async run(ctx, input) {
    return { session: await retrySession(ctx.db, actor(ctx), input) };
  },
});

const answerCapability = defineCapability({
  name: "answerAgentApproval",
  title: "Answer agent approval request",
  description: `Answer what an agent session asked. A request that names its action (a tool and its input) is a permission: approve or deny it. One that names none is a question: answer it in words (decision answer, with the note) or deny it; it cannot be approved. A person's decision: only the person who started the session or the agent's owner, never an agent. ${agentSession.rule("answerApproval")}`,
  kind: "command",
  surfaces: everywhere,
  decision: true,
  input: z.object({
    organizationId,
    sessionId,
    approvalId: id.describe(
      "The pending approval request id (getAgentSession or listAgentApprovalsWaiting).",
    ),
    decision: z
      .enum(["approve", "deny", "answer"])
      .describe(
        "approve or deny a permission; answer (with the note) or deny a question.",
      ),
    note: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .describe(
        "A message to the agent with your answer; required to answer a question.",
      ),
  }),
  async run(ctx, input) {
    return { session: await answerApproval(ctx.db, actor(ctx), input) };
  },
});

export const factoryCapabilities = [
  listAgentsCapability,
  createAgentCapability,
  updateAgentCapability,
  archiveAgentCapability,
  listAgentActivityCapability,
  listAgentTokensCapability,
  createAgentTokenCapability,
  revokeAgentTokenCapability,
  listRunnersCapability,
  createRunnerRegistrationCapability,
  revokeRunnerCapability,
  listSessionsCapability,
  getSessionCapability,
  sessionEventsCapability,
  waitingCapability,
  startSessionCapability,
  sendMessageCapability,
  interruptCapability,
  cancelCapability,
  retryCapability,
  answerCapability,
] as AnyCapability[];
