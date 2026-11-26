import { z } from "zod";

// The runner protocol (`/api/runner/v1/*`), shared by the server and
// `apps/runner`. It is outbound-only from the runner: HTTPS requests with a
// bearer runner credential, long-polls for assignments and steering. Every
// write about a session carries the lease token of the claim that produced
// it, so a runner that lost its lease cannot overwrite a newer attempt.
//
// This module depends on zod alone: the runner binary bundles it.

export const RUNNER_PROTOCOL = 1;
export const RUNNER_API = "/api/runner/v1";

export const REGISTRATION_TOKEN_PREFIX = "lrt_";
export const RUNNER_CREDENTIAL_PREFIX = "lcr_";

// The longest a long-poll waits before answering "nothing yet".
export const MAX_POLL_SECONDS = 25;
// A lease lasts this long past the runner's last heartbeat or write.
export const LEASE_SECONDS = 90;
// The runner heartbeats this often; a runner unseen for three heartbeats
// is offline.
export const HEARTBEAT_SECONDS = 15;
export const ONLINE_SECONDS = 60;

export const limits = {
  // Events in one batch, and the batch's serialized size.
  batchEvents: 200,
  batchBytes: 512 * 1024,
  // One event's serialized `data`; longer strings are cut by `boundEvent`.
  eventBytes: 16 * 1024,
  text: 12_000,
  output: 8_000,
  // Model proxy request body.
  modelRequestBytes: 4 * 1024 * 1024,
} as const;

// ------------------------------------------------------------- harnesses

export const harnessIds = [
  "claude-code",
  "codex",
  "opencode",
  "gemini",
  "lictory",
] as const;
export type HarnessId = (typeof harnessIds)[number];
export const harnessLabels: Record<HarnessId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
  lictory: "Lictory (built in)",
};

export const isolationModes = ["host", "container"] as const;
export type Isolation = (typeof isolationModes)[number];

// ---------------------------------------------------------------- events

// What a session's log holds. Runners write the first group; the server
// writes `status`, `user_message`, `approval_answer` and `context` (what
// Lictory told the agent besides a person's words: where it was asked, the
// quoted conversation, a policy's task).
export const sessionEventTypes = [
  "message",
  "reasoning",
  "tool_call",
  "tool_result",
  "command",
  "file_change",
  "approval_request",
  "error",
  "summary",
  "status",
  "user_message",
  "approval_answer",
  "context",
] as const;
export type SessionEventType = (typeof sessionEventTypes)[number];
export const runnerEventTypes = [
  "message",
  "reasoning",
  "tool_call",
  "tool_result",
  "command",
  "file_change",
  "approval_request",
  "error",
  "summary",
  "status",
] as const satisfies readonly SessionEventType[];

// Status phases a runner reports that move the session: the harness waits
// on a person's next message (running → waiting), and works again
// (waiting → running, once no approval request is pending).
export const runnerPhases = {
  awaitingMessage: "awaiting_message",
  working: "working",
} as const;

const text = (max: number) => z.string().max(max * 2);
const shortText = z.string().max(400);

// Event payloads by type. Unknown fields are dropped; strings are bounded
// again by `boundEvent` before they are stored.
export const runnerEventData = {
  message: z.object({ text: text(limits.text) }),
  reasoning: z.object({ text: text(limits.text) }),
  tool_call: z.object({
    callId: shortText,
    name: shortText,
    input: z.unknown().optional(),
    summary: shortText.optional(),
  }),
  tool_result: z.object({
    callId: shortText,
    output: text(limits.output).optional(),
    isError: z.boolean().optional(),
  }),
  command: z.object({
    callId: shortText.optional(),
    command: text(4000),
    output: text(limits.output).optional(),
    exitCode: z.number().int().nullable().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  file_change: z.object({
    changes: z
      .array(
        z.object({
          path: z.string().max(1000),
          kind: z.enum(["add", "modify", "delete", "rename"]),
          additions: z.number().int().nonnegative().optional(),
          deletions: z.number().int().nonnegative().optional(),
        }),
      )
      .max(200),
    diff: text(limits.output).optional(),
  }),
  approval_request: z.object({
    requestId: z.string().min(1).max(200),
    title: z.string().min(1).max(300),
    tool: shortText.optional(),
    input: z.unknown().optional(),
    reason: z.string().max(2000).optional(),
  }),
  error: z.object({
    message: z.string().max(4000),
    retryable: z.boolean().optional(),
  }),
  summary: z.object({ text: text(limits.text) }),
  status: z.object({
    phase: z.string().max(80),
    message: z.string().max(1000).optional(),
  }),
} satisfies Record<(typeof runnerEventTypes)[number], z.ZodType>;

export const runnerEventSchema = z.discriminatedUnion(
  "type",
  runnerEventTypes.map((type) =>
    z.object({
      // The runner's sequence for this attempt: 1, 2, 3… without gaps.
      seq: z.number().int().positive(),
      type: z.literal(type),
      at: z.string().datetime().optional(),
      data: runnerEventData[type],
    }),
  ) as unknown as [
    z.ZodObject<{
      seq: z.ZodNumber;
      type: z.ZodLiteral<(typeof runnerEventTypes)[number]>;
      at: z.ZodOptional<z.ZodString>;
      data: z.ZodType;
    }>,
  ],
);
export type RunnerEvent = {
  seq: number;
  type: (typeof runnerEventTypes)[number];
  at?: string;
  data: Record<string, unknown>;
};

const cut = (value: string, max: number) =>
  value.length > max
    ? `${value.slice(0, max)}\n… (${value.length - max} more characters)`
    : value;

// Bounds every string in an event payload and the payload as a whole, so a
// runaway tool output can never bloat the log. Pure; used on both sides.
export function boundEvent(
  data: unknown,
  maxString: number = limits.text,
): Record<string, unknown> {
  const walk = (value: unknown, depth: number): unknown => {
    if (typeof value === "string") return cut(value, maxString);
    if (depth > 6) return "…";
    if (Array.isArray(value))
      return value.slice(0, 200).map((v) => walk(v, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .slice(0, 100)
          .map(([k, v]) => [k.slice(0, 100), walk(v, depth + 1)]),
      );
    return value;
  };
  const bounded = (walk(data, 0) ?? {}) as Record<string, unknown>;
  if (JSON.stringify(bounded).length <= limits.eventBytes) return bounded;
  // Still too large: shrink each field, then give up on the detail.
  const shrink = (value: unknown) => {
    if (typeof value === "string") return cut(value, 1500);
    const json = JSON.stringify(value) ?? "";
    return json.length > 1500 ? cut(json, 1500) : value;
  };
  const shrunk: Record<string, unknown> = {
    ...Object.fromEntries(
      Object.entries(bounded).map(([k, v]) => [k, shrink(v)]),
    ),
    truncated: true,
  };
  return JSON.stringify(shrunk).length <= limits.eventBytes
    ? shrunk
    : { truncated: true };
}

// --------------------------------------------------------------- requests

const harnessReport = z
  .array(
    z.object({
      id: z.enum(harnessIds),
      version: z.string().max(80).nullable(),
    }),
  )
  .max(harnessIds.length);

export const machineReport = z.object({
  os: z.string().max(40),
  arch: z.string().max(40),
  version: z.string().max(40),
  hostname: z.string().max(200).optional(),
  harnesses: harnessReport,
  labels: z.array(z.string().min(1).max(40)).max(20).optional(),
  maxSessions: z.number().int().min(1).max(64),
  isolation: z.enum(isolationModes),
});
export type MachineReport = z.infer<typeof machineReport>;

export const registerRequest = machineReport.extend({
  token: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(80),
});
export const registerResponse = z.object({
  runnerId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  personal: z.boolean(),
  credential: z.string(),
});

export const heartbeatRequest = machineReport.extend({
  // Sessions the runner is executing; their leases are renewed.
  sessions: z
    .array(z.object({ sessionId: z.string(), leaseToken: z.string() }))
    .max(64),
});
export const heartbeatResponse = z.object({
  serverTime: z.string(),
  leases: z.array(
    z.object({
      sessionId: z.string(),
      held: z.boolean(),
      status: z.string().nullable(),
      leaseExpiresAt: z.string().nullable(),
    }),
  ),
});

export const claimRequest = z.object({
  wait: z.number().int().min(0).max(MAX_POLL_SECONDS).default(MAX_POLL_SECONDS),
});

export const assignment = z.object({
  sessionId: z.string(),
  leaseToken: z.string(),
  leaseExpiresAt: z.string(),
  attempt: z.number().int(),
  organizationId: z.string(),
  title: z.string(),
  prompt: z.string(),
  agent: z.object({
    id: z.string(),
    name: z.string(),
    handle: z.string(),
    harness: z.enum(harnessIds),
    model: z.string().nullable(),
    instructions: z.string(),
    access: z.enum(["read", "write"]),
  }),
  requestedBy: z.object({ id: z.string(), name: z.string() }),
  workItem: z
    .object({ id: z.string(), key: z.string(), title: z.string() })
    .nullable(),
  repository: z
    .object({
      url: z.string().nullable(),
      baseBranch: z.string().nullable(),
      branch: z.string(),
    })
    .nullable(),
  // A session-scoped Lictory access token for Lictory's MCP tools; it acts
  // as the agent and stops working when the session ends.
  lictory: z.object({ url: z.string(), mcpUrl: z.string(), token: z.string() }),
  // Steering inputs after this sequence belong to this attempt.
  inputCursor: z.number().int().nonnegative(),
  // Lictory Intelligence is available to the built-in harness.
  modelProxy: z.boolean(),
});
export type Assignment = z.infer<typeof assignment>;

const leased = z.object({ leaseToken: z.string().min(1).max(200) });

export const startRequest = leased;

export const eventsRequest = leased.extend({
  events: z.array(z.unknown()).min(1).max(limits.batchEvents),
});
export const eventsResponse = z.object({
  // The runner sequence the server has stored; resend anything after it.
  acked: z.number().int().nonnegative(),
  status: z.string(),
});

export const inputKinds = [
  "message",
  "interrupt",
  "cancel",
  "approval_answer",
] as const;
export type InputKind = (typeof inputKinds)[number];
export const sessionInput = z.object({
  seq: z.number().int(),
  kind: z.enum(inputKinds),
  at: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type SessionInput = z.infer<typeof sessionInput>;
export const inputsResponse = z.object({
  status: z.string(),
  inputs: z.array(sessionInput),
});

export const completeRequest = leased.extend({
  outcome: z.enum(["completed", "failed"]),
  summary: z.string().max(limits.text).optional(),
  error: z.string().max(4000).optional(),
  branch: z.string().max(250).optional(),
  // Events the runner wrote, so the server knows none are missing.
  lastSeq: z.number().int().nonnegative(),
});

export const workspaceResponse = z.object({
  repository: z
    .object({
      url: z.string(),
      baseBranch: z.string().nullable(),
      branch: z.string(),
      // Short-lived credentials for this repository only, when the code
      // host integration brokers them. Never stored by the runner.
      auth: z
        .object({
          username: z.string(),
          password: z.string(),
          expiresAt: z.string().nullable(),
        })
        .nullable(),
    })
    .nullable(),
});
export type WorkspaceResponse = z.infer<typeof workspaceResponse>;

export const modelRequest = leased.extend({
  // LanguageModel call options (prompt, tools, settings) without the abort
  // signal or headers, as the AI SDK passes them to `doStream`.
  call: z.record(z.string(), z.unknown()),
});

// The error shape every protocol endpoint answers with.
export type ProtocolError = {
  error: {
    category: string;
    message: string;
    // lease_lost, sequence_gap, rate_limited, revoked, invalid_state…
    kind?: string;
    acked?: number;
  };
};
