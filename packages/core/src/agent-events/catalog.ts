import type { NotificationKind } from "@lictory/core/notifications/catalog";

// The agent event catalog (docs/internals/agent-events.md): what an external
// agent can be woken for. Every type is *addressed*: it names something
// waiting on a person or one of their agents. Events are derived from the
// same notices notifications are (notifications/events.ts), before anyone's
// notification preferences apply, plus a few agent-only notices that never
// reach an inbox (claims, code host pull requests, page pull request
// decisions).
//
// An event says what happened, never what to do: it grants nothing, and the
// agent reads the details through its ordinary, authorized tools.

// Notices that only produce agent events, never notification rows.
const agentOnlyKinds = [
  // An agent was @mentioned in a channel (narrowed to that agent).
  "agent_mentioned",
  // A claim's question was resolved, or the claim ended.
  "claim_question_resolved",
  "claim_released",
  // A page pull request was approved or had changes requested.
  "page_pull_request_decided",
  // Code host pull requests (the Code module calls
  // `queueCodePullRequestEvent`).
  "code_pull_request_decided",
  "code_pull_request_merged",
  "code_pull_request_unmergeable",
] as const;
export type AgentOnlyKind = (typeof agentOnlyKinds)[number];
export const isAgentOnlyKind = (kind: string): kind is AgentOnlyKind =>
  (agentOnlyKinds as readonly string[]).includes(kind);

type SourceKind = NotificationKind | AgentOnlyKind;

type Definition = {
  label: string;
  description: string;
  from: readonly SourceKind[];
};

export const agentEventTypes = {
  "channel.mentioned": {
    label: "Mentioned in a channel",
    description:
      "You, or your agent, were @mentioned in a channel, thread or direct message.",
    from: ["channel_mentioned", "agent_mentioned"],
  },
  "channel.direct_message": {
    label: "Direct message",
    description: "Someone sent you a direct message.",
    from: ["direct_message"],
  },
  "discussion.mentioned": {
    label: "Mentioned in a discussion",
    description:
      "You were @mentioned in a discussion on a specification or a page.",
    from: ["mentioned", "page_mentioned"],
  },
  "discussion.blocking": {
    label: "Blocking discussion",
    description:
      "A blocking discussion was opened on a specification or page you are involved in.",
    from: ["blocking_thread", "page_blocking_thread"],
  },
  "review.requested": {
    label: "Review requested",
    description:
      "You, or a discipline you belong to, were asked to review a specification, a pull request, a suggestion or a page change.",
    from: [
      "review_requested",
      "pull_request_review_requested",
      "suggestion_review_requested",
      "page_review_requested",
    ],
  },
  "review.decided": {
    label: "Review decided",
    description:
      "A reviewer approved, requested changes on, or revoked approval of a specification or suggestion you own or requested review for.",
    from: ["review_decided", "suggestion_decided"],
  },
  "approval.invalidated": {
    label: "Approval went stale",
    description:
      "Something you approved changed, so your approval needs your review again.",
    from: ["approval_invalidated", "page_approval_invalidated"],
  },
  "item.assigned": {
    label: "Assigned to you",
    description: "A work item was assigned to you.",
    from: ["assigned"],
  },
  "item.ready": {
    label: "Ready for delivery",
    description:
      "Every readiness check passes for a specification you are involved in.",
    from: ["item_ready"],
  },
  "pull_request.decided": {
    label: "Pull request decided",
    description:
      "A reviewer approved or requested changes on a pull request you authored or collaborate on (specification, page or code).",
    from: [
      "pull_request_decided",
      "page_pull_request_decided",
      "code_pull_request_decided",
    ],
  },
  "pull_request.mergeable": {
    label: "Pull request ready to merge",
    description:
      "A specification pull request you authored meets its merge requirements.",
    from: ["pull_request_mergeable"],
  },
  "pull_request.merged": {
    label: "Pull request merged",
    description:
      "A pull request you authored, collaborate on or reviewed was merged.",
    from: ["pull_request_merged", "code_pull_request_merged"],
  },
  "pull_request.unmergeable": {
    label: "Pull request no longer mergeable",
    description:
      "A code pull request linked to your work can no longer be merged (conflicts or failing required checks).",
    from: ["code_pull_request_unmergeable"],
  },
  "agent.approval_requested": {
    label: "Agent asks for a decision",
    description:
      "An agent session you started, or whose agent you own, waits for a person to approve or deny something. Only a person can answer it.",
    from: ["agent_approval_requested"],
  },
  "agent.session_finished": {
    label: "Agent session finished",
    description: "An agent session you started completed or failed.",
    from: ["agent_session_finished"],
  },
  "claim.question_resolved": {
    label: "Agent's question resolved",
    description:
      "A person resolved a question your agent asked on its claimed work.",
    from: ["claim_question_resolved"],
  },
  "claim.released": {
    label: "Agent's claim ended",
    description:
      "Your agent's claim ended: released by a person, expired without renewal, or completed by its Definition of Done.",
    from: ["claim_released"],
  },
} as const satisfies Record<string, Definition>;

export type AgentEventType = keyof typeof agentEventTypes;
export const agentEventTypeList = Object.keys(
  agentEventTypes,
) as AgentEventType[];
export const isAgentEventType = (type: string): type is AgentEventType =>
  type in agentEventTypes;

const bySource = new Map<string, AgentEventType>(
  agentEventTypeList.flatMap((type) =>
    agentEventTypes[type].from.map((kind) => [kind, type] as const),
  ),
);

// The agent event a notice of this kind produces, if any.
export function agentEventTypeOf(kind: string): AgentEventType | undefined {
  return bySource.get(kind);
}

// What an event may carry about its subject: identifiers, short titles and
// facts. Specification text, message bodies and excerpts, agent output and
// error texts never leave through events.
const identifiers = [
  "workItemId",
  "itemKey",
  "projectKey",
  "threadId",
  "reviewId",
  "pullRequestId",
  "suggestionId",
  "channelId",
  "messageId",
  "threadRootId",
  "spaceId",
  "spaceSlug",
  "pageId",
  "sessionId",
  "approvalId",
  "claimId",
  "repositoryId",
  "codePullRequestId",
] as const;
const titles = [
  "title",
  "pullRequestTitle",
  "suggestionTitle",
  "pageTitle",
  "spaceName",
  "channelName",
  "sessionTitle",
  "agentName",
] as const;
const facts = [
  "responsibility",
  "required",
  "revision",
  "decision",
  "status",
  "reason",
  "blocking",
  "channelKind",
  "target",
  "state",
  "number",
  "provider",
] as const;
const subjectKeys: readonly string[] = [...identifiers, ...titles, ...facts];
const TITLE_LIMIT = 200;

export function eventSubject(
  detail: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const subject: Record<string, string | number | boolean> = {};
  for (const key of subjectKeys) {
    const value = detail?.[key];
    if (typeof value === "string" && value.length)
      subject[key] =
        value.length > TITLE_LIMIT
          ? `${value.slice(0, TITLE_LIMIT - 1)}…`
          : value;
    else if (typeof value === "number" || typeof value === "boolean")
      subject[key] = value;
  }
  return subject;
}

// JSON Schema of an event's `data` (MCP `payloadSchema`). Every type has
// the same shape; `subject` holds what applies to the type.
const stringProps = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, { type: "string" }]));
export const eventDataSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Lictory's id of this event." },
    type: { type: "string", enum: agentEventTypeList },
    occurredAt: { type: "string", format: "date-time" },
    organizationId: { type: "string" },
    organizationSlug: { type: "string" },
    projectId: { type: ["string", "null"] },
    agentId: {
      type: ["string", "null"],
      description:
        "Set when the event is addressed to one agent rather than to the person.",
    },
    actorId: {
      type: ["string", "null"],
      description: "The person whose action caused the event, if any.",
    },
    subject: {
      type: "object",
      description:
        "Identifiers and short titles of what the event is about. Read details with Lictory's tools (getWorkItem, readChannelThread, …).",
      properties: {
        ...stringProps([...identifiers, ...titles]),
        responsibility: { type: "string" },
        required: { type: "boolean" },
        revision: { type: "number" },
        decision: { type: "string" },
        status: { type: "string" },
        reason: { type: "string" },
        blocking: { type: "boolean" },
        channelKind: { type: "string" },
        target: { type: "string" },
        state: { type: "string" },
        number: { type: "number" },
        provider: { type: "string" },
      },
      additionalProperties: false,
    },
    url: {
      type: "string",
      description: "Where a person opens it in Lictory.",
    },
  },
  required: ["id", "type", "occurredAt", "organizationId", "subject", "url"],
  additionalProperties: false,
} as const;

// One sentence a person (or a model) can read, from identifiers and titles
// only. Titles are quoted: they are data people wrote, never instructions.
export function describeAgentEvent(event: {
  type: string;
  subject: Record<string, unknown>;
}): string {
  const s = event.subject;
  const text = (key: string) => {
    const value = s[key];
    return typeof value === "string" ? value : undefined;
  };
  const quoted = (value: string | undefined) =>
    value ? ` “${value.replace(/[\r\n]+/g, " ")}”` : "";
  const item = text("itemKey")
    ? `${text("itemKey")}${quoted(text("title"))}`
    : quoted(text("title")).trim();
  const pr = quoted(text("pullRequestTitle")).trim();
  const page = quoted(text("pageTitle")).trim();
  const where = text("channelName")
    ? `#${text("channelName")}`
    : text("channelKind") === "direct"
      ? "a direct message"
      : "a channel";
  switch (event.type) {
    case "channel.mentioned":
      return `You were mentioned in ${where}.`;
    case "channel.direct_message":
      return "You received a direct message.";
    case "discussion.mentioned":
      return `You were mentioned in a discussion on ${item || page || "a specification"}.`;
    case "discussion.blocking":
      return `A blocking discussion was opened on ${item || page || "a specification"}.`;
    case "review.requested":
      return `Your review was requested on ${pr || item || page || "a change"}${text("responsibility") ? ` (${text("responsibility")})` : ""}.`;
    case "review.decided":
      return `A review decision (${text("decision") ?? "decided"}) was recorded on ${item || "a specification"}.`;
    case "approval.invalidated":
      return `Your approval of ${pr || item || page || "a change"} went stale and needs your review again.`;
    case "item.assigned":
      return `${item || "A work item"} was assigned to you.`;
    case "item.ready":
      return `${item || "A specification"} passes every readiness check.`;
    case "pull_request.decided":
      return `A reviewer decided (${text("decision") ?? "decided"}) on ${pr || page || "your pull request"}.`;
    case "pull_request.mergeable":
      return `${pr || "Your pull request"} meets its merge requirements.`;
    case "pull_request.merged":
      return `${pr || "A pull request"} was merged.`;
    case "pull_request.unmergeable":
      return `${pr || "A pull request"} can no longer be merged.`;
    case "agent.approval_requested":
      return `${text("agentName") ?? "An agent"} waits for a person's decision in session${quoted(text("sessionTitle"))}.`;
    case "agent.session_finished":
      return `Agent session${quoted(text("sessionTitle"))} ${text("status") ?? "finished"}.`;
    case "claim.question_resolved":
      return `A question on claimed work ${item || ""} was resolved.`.replace(
        "  ",
        " ",
      );
    case "claim.released":
      return `The claim on ${item || "a work item"} ended (${text("reason") ?? "released"}).`;
    default:
      return "Something in Lictory is waiting for you.";
  }
}
