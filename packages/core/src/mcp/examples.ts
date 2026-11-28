// Example arguments for each MCP tool, as the generated reference shows them
// (scripts/mcp-reference.ts). An example is the tool's required fields (and
// its retry key, a habit worth copying), with values that read like a real
// call; when those alone are refused (a tool that takes one of two fields,
// such as getWorkItem's workItemId or key) it adds the first optional field
// that makes it valid. Every example passes the tool's own input schema, so
// a reader who copies one is never refused for its shape.
import { createHash } from "node:crypto";

import type { AnyCapability } from "@lictory/core/capabilities/core";
import { inputSchemaOf } from "@lictory/core/mcp/server";

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  format?: string;
  minimum?: number;
};

// Example values by field name, so an example call reads like one.
const sampleValues: Record<string, unknown> = {
  organizationId: "acme",
  workItemId: "PAY-142",
  key: "PAY-142",
  projectId: "3b0f6c1e-5d2a-4e8b-9f61-2a7c4d9e8b10",
  mutationId: "6f1d2c3b-8a9e-4f70-b1c2-d3e4f5a6b7c8",
  title: "Retry failed refunds once",
  name: "payments",
  query: "refund",
  q: "refund",
  body: "Can a refund be retried after settlement?",
  note: "Tests for the retry window pass; next: the settlement case.",
  question: "Does a retry reuse the original transaction id?",
  section: "Failure behavior",
  content: "## Problem\n\nRefunds that time out are never retried.",
  description: "## Problem\n\nRefunds that time out are never retried.",
  message: "Define the retry window",
  prompt: "Implement PAY-142 and open a pull request.",
  after: "latest",
  startsAt: "2026-12-01",
  endsAt: "2026-12-14",
  targetDate: "2026-12-15",
  slackChannelId: "C0123ABCD",
};

// Fields whose value depends on the tool (a project key, not an item key),
// or whose shape a name cannot say.
const toolValues: Record<string, Record<string, unknown>> = {
  createProject: { key: "PAY" },
  setOrganizationBrandColor: { color: "#2563eb" },
  createPageThread: { anchor: { v: 1, kind: "page" } },
  draftProposals: {
    sources: [
      {
        label: "Customer call, 2 Nov",
        text: "Refunds that time out are never retried; support retries them by hand.",
      },
    ],
  },
  setNotificationPreferences: {
    rules: [{ kind: "review_requested", inApp: true, email: false }],
  },
};

// A stable, valid-looking UUID for an example identifier.
function sampleId(field: string) {
  const hex = createHash("sha256").update(field).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sampleOf(field: string, schema: Schema): unknown {
  if (field in sampleValues) return sampleValues[field];
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  const variants = (schema.anyOf ?? schema.oneOf ?? []).filter(
    (v) => v.type !== "null",
  );
  if (variants.length) return sampleOf(field, variants[0]!);
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "boolean") return true;
  if (type === "integer" || type === "number") return schema.minimum ?? 1;
  if (type === "array")
    return schema.items
      ? [sampleOf(field.replace(/s$/, ""), schema.items)]
      : [];
  if (type === "object") return requiredSample(schema);
  if (/Ids?$/.test(field) || schema.format === "uuid") return sampleId(field);
  return field;
}

function requiredSample(schema: Schema, own: Record<string, unknown> = {}) {
  const required = new Set(schema.required ?? []);
  return Object.fromEntries(
    Object.entries(schema.properties ?? {})
      .filter(([name]) => required.has(name) || name === "mutationId")
      .map(([name, field]) => [
        name,
        name in own ? own[name] : sampleOf(name, field),
      ]),
  );
}

/** The example arguments of a tool; throws when none passes its schema. */
export function exampleArguments(
  capability: AnyCapability,
): Record<string, unknown> {
  const schema = inputSchemaOf(capability) as Schema;
  const base = requiredSample(schema, toolValues[capability.name]);
  const valid = (args: Record<string, unknown>) =>
    capability.input.safeParse(args).success;
  if (valid(base)) return base;
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    if (name in base) continue;
    const args = { ...base, [name]: sampleOf(name, field) };
    if (valid(args)) return args;
  }
  throw new Error(
    `No valid example arguments for ${capability.name}: ${capability.input.safeParse(base).error?.message}`,
  );
}
