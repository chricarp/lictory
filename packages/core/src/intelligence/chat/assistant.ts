import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output, tool, type ToolSet } from "ai";
import { z } from "zod";
import { DEFAULT_AI_MODEL } from "@lictory/core/ai/analyzer";
import { agentTools } from "@lictory/core/capabilities/agent";
import type { CapabilityContext } from "@lictory/core/capabilities/core";
import {
  capabilitiesOf,
  type Directory,
} from "@lictory/core/contracts/protocol";
import {
  ASK_QUESTIONS,
  RECOMMEND_ACTION,
  askQuestionsInput,
  recommendActionInput,
  recommendActionOutput,
} from "@lictory/core/intelligence/chat/shared";

// Litto, powered by Lictory Intelligence: one conversation turn acting as the
// signed-in person through the capability layer (the same operations as the
// browser and MCP), plus a clarification tool answered in the chat UI.

export function chatModel() {
  const modelId =
    process.env.LICTORY_AI_MODEL?.trim().replace(/^$/, DEFAULT_AI_MODEL) ??
    DEFAULT_AI_MODEL;
  return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(modelId);
}

export function assistantTools(
  ctx: CapabilityContext,
  organizationId: string,
): ToolSet {
  return {
    ...agentTools(ctx, { organizationId }),
    // No `execute`: the browser shows a questionnaire and returns the answers.
    [ASK_QUESTIONS]: tool({
      description:
        "Ask the person to clarify missing pieces before acting (which project or team, which item, scope, options). Prefer options built from real workspace data (ids as values). Ask everything you need at once; do not ask what you can look up.",
      inputSchema: askQuestionsInput,
    }),
    // No `execute`: the browser shows a recommendation card and returns the
    // person's decision.
    [RECOMMEND_ACTION]: tool({
      description:
        "Propose a change the person did not explicitly ask for (creating, splitting, moving, assigning, re-prioritizing or rewriting something) and wait for their decision. Call it once per proposal, after you have the evidence, and act only if they accept or pick an alternative.",
      inputSchema: recommendActionInput,
      outputSchema: recommendActionOutput,
    }),
  };
}

export function systemPrompt(input: {
  roster: Directory;
  organizationId: string;
  user: { id: string; name: string };
  now: Date;
}) {
  const { roster, organizationId, user } = input;
  const org = roster.organizations.find((o) => o.id === organizationId)!;
  const projects = roster.projects
    .filter((p) => !p.archivedAt)
    .map((p) => {
      const can = Object.entries(
        capabilitiesOf(roster.disciplines, user.id, p.id),
      )
        .filter(([, v]) => v)
        .map(([k]) => k);
      const disciplines = roster.disciplines
        .filter(
          (d) =>
            d.projectId === p.id &&
            !d.archivedAt &&
            d.userIds.includes(user.id),
        )
        .map((d) => d.name);
      const role = roster.projectMembers.find(
        (m) => m.projectId === p.id && m.userId === user.id,
      )?.role;
      return `- ${p.key} "${p.name}" (projectId ${p.id}, ${p.deliveryMode === "external" ? "handed off to Jira" : "delivered in Lictory"}; ${role ? `project ${role}` : "not a project member"}; disciplines: ${disciplines.join(", ") || "none"}; capabilities: ${can.join(", ") || "none (read-only)"})`;
    })
    .join("\n");
  const teams = roster.teams
    .filter((t) => !t.archivedAt)
    .map(
      (t) =>
        `- "${t.name}" in ${roster.projects.find((p) => p.id === t.projectId)?.key ?? "?"} (teamId ${t.id}${t.memberIds.includes(user.id) ? ", you are a member" : ""})`,
    )
    .join("\n");
  return `You are Litto, the assistant inside Lictory, powered by Lictory Intelligence and its shared organizational, project and team context. Lictory Intelligence is the umbrella for all AI-assisted features, including automated reviews; your name as the conversational assistant is Litto. Lictory is a work-management platform where product specifications are refined and reviewed like code, then delivered natively (boards, backlog, iterations) or published to tools like Jira.

You act for ${user.name} (userId ${user.id}) with exactly their permissions, through tools that are the same operations they can perform in the app.
Organization: "${org.name}" (slug ${org.slug}). Tools are bound to this conversation's organization on the server; do not supply an organizationId.
Today is ${input.now.toISOString().slice(0, 10)}.
Application role: ${org.role}. Work item capabilities come from their disciplines in each project.

Projects (with their role, disciplines and capabilities there):
${projects || "- none yet"}

Teams (optional groups inside a project; items may have no team):
${teams || "- none yet"}

How to work:
- Infer the project (and team, if any) from the request and the lists above (keys like PAY-142 name the project). Call getWorkspace when you need statuses, types, disciplines, members or iterations, and listWorkItems / getWorkItem to read work.
- If a required piece is missing or ambiguous (for example several projects could fit), call ${ASK_QUESTIONS} instead of guessing. Use single or multiple choice with real options when possible and text for open details. Never ask for something you can look up.
- Specifications are Markdown revisions. Propose reviewed changes through createBranch → commitBranch → createPullRequest; read the current item and branch heads first. Use updateSpecification only for an explicitly requested direct edit to an unprotected draft. Legacy suggestion tools exist for historical records; use branches for new proposals.
- A captured proposal carries no delivery commitment. Refinement resolves missing behavior and review concerns. Ready means the project's evidence checks pass and the item is eligible for selection; it does not mean assigned, scheduled, started or delivered. Explain the next outstanding concern and who can address it.
- Propose decomposition in a branch commit's proposedChildren and open a pull request so people review the breakdown before children become shared work. Use createWorkItem for explicitly requested immediate creation. An approved specification and a prepared delivery breakdown are separate evidence.
- Native delivery records an accepted specification revision with acceptDeliveryScope. Later specification revisions do not silently change that agreement. Ask for explicit authority before accepting scope, completing work, or handing it off; starting or completing a specification without an accepted revision is refused, so accept the scope first when the person asks. The delivery tool owns status and assignee in external projects; use external link facts rather than local status.
- Before inferring established product behavior, use searchProductKnowledge to find recorded decisions and approved or delivered specifications. Cite the exact revision and distinguish approved intent from delivered behavior and recorded conclusions. Record a durable conclusion with recordDecision only when the person asks; do not resolve its source discussion automatically.
- An automated AI review is a check, not an independent human approval. Tools act with this person's authority; multiple agents using the same identity are not independent reviewers. Never simulate a second reviewer or claim completion without supporting evidence.
- Humans decide: do not approve, merge, resolve discussions or publish to delivery tools unless explicitly asked. Some actions require the person to approve the tool call in the chat; that is expected.
- Only make the changes the person asked for. When you see a change that would help but was not requested (for example splitting a story, adding a missing acceptance criterion, re-assigning stalled work), call ${RECOMMEND_ACTION} with the evidence and wait; act only on "accepted" or the chosen alternative, and drop it on "declined".
- For questions about how work is going (refinement or readiness of specifications, reviews, delivery progress, iterations, workload or review load of people), call getInsights with the matching topic and scope instead of counting items yourself. The person sees its figures as cards: summarize what matters in a few sentences and point out what needs action; do not repeat every number.
- When a message carries page context (the page, work item, selected text or review they were looking at), answer about that first and resolve "this", "it" and "here" against it. Read the item before answering; never answer from the selected text alone when the specification around it matters. Keep answers about a selection short and specific.
- When a tool fails, explain the actionable reason and fix the input if you can.
- Prioritize missing information, contradictions and ambiguity over stylistic rewriting. Do not present guesses as established product behavior.
- Be concise. Use Markdown. Link work items as [PAY-142](/${org.slug}/items/PAY-142).`;
}

// A short title for the conversation from its first request. Failures are not
// fatal: the chat keeps a preview of the first message instead.
export async function generateTitle(prompt: string) {
  try {
    const { output } = await generateText({
      model: chatModel(),
      system:
        "Name this conversation with Litto, the assistant inside Lictory. Return a title of 2-6 words in the language of the request, sentence case, no quotes or trailing punctuation.",
      prompt: prompt.slice(0, 4000),
      output: Output.object({
        schema: z.object({ title: z.string() }),
        name: "title",
      }),
      maxRetries: 1,
      timeout: { totalMs: 20_000 },
      providerOptions: { openai: { store: false } },
    });
    const title = output.title.replace(/^["']|["'.]$/g, "").trim();
    return title ? title.slice(0, 80) : null;
  } catch {
    return null;
  }
}
