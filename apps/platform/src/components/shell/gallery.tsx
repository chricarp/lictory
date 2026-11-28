import { useState, type ReactNode } from "react";
import {
  Bot,
  FileText,
  Inbox,
  MessageCircleQuestion,
  Palette,
  Plus,
  Search,
} from "lucide-react";
import type {
  AgentEntity,
  ApprovalEntity,
  RunnerEntity,
  SessionEntity,
  SessionStatus,
} from "@lictory/core/factory/entities";
import { Button } from "@lictory/ui/button";
import { MissingState } from "@lictory/ui/status-page";
import { StatusChip, type StatusTone } from "@lictory/ui/status-chip";
import { sessionState } from "@lictory/platform/lib/session-state";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  Actor,
  AgentActor,
  AgentAvatar,
  Facepile,
  PersonAvatar,
  PolicyActor,
  type ActorSize,
  type Person,
} from "@lictory/platform/components/identity/actor";
import {
  PageHeader,
  PageLinkTabs,
  PhoneChromeContext,
} from "@lictory/platform/components/shell/page-header";
import {
  Panel,
  SectionCaption,
} from "@lictory/platform/components/shell/panel";
import { ListRow } from "@lictory/platform/components/shell/list-row";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import { ApprovalRequest } from "@lictory/platform/components/shell/approval-request";
import { SetupChecklist } from "@lictory/platform/components/shell/home/setup-checklist";
import { setupSteps } from "@lictory/platform/components/shell/home/setup";

// The design gallery (/{org}/design-system): every shared building block in
// light and dark with realistic data, for the module streams adopting them
// and for design audits. Not linked from the navigation; examples change
// nothing (approvals are answered locally).

const people: Person[] = [
  { id: "p-ada", name: "Ada Lovelace" },
  { id: "p-ben", name: "Ben Ortiz" },
  { id: "p-cara", name: "Cara Singh" },
  { id: "p-dev", name: "Dev Patel" },
  { id: "p-eli", name: "Eli Novak" },
  { id: "p-fay", name: "Fay Okafor" },
];
const slackPerson: Person = {
  id: "slack-U02",
  name: "Mira Jensen",
  external: "slack",
};
const forge = { id: "a-forge", name: "Forge", avatar: "🔨" };
const sentry = { id: "a-sentry", name: "Sentry", avatar: null };
const scout = { id: "a-scout", name: "Scout", avatar: "🛰️" };

// Real-looking ids: the examples read (empty) event logs through the same
// queries as real sessions.
const galleryIds = {
  session: "78b44bcb-a8b2-51e2-91c7-721cc4e56b8a",
  otherSession: "4b603188-896b-5566-b72c-0bfaa4495072",
};

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();

function fakeSession(
  status: SessionStatus,
  overrides: Partial<SessionEntity> = {},
): SessionEntity {
  return {
    type: "session",
    id: galleryIds.session,
    agentId: forge.id,
    runnerId: "r-1",
    requestedRunnerId: null,
    requestedById: "p-ada",
    startedByPolicy: null,
    status,
    title: "PAY-6: Duplicate charge when the provider times out",
    prompt: "",
    workItemId: null,
    projectId: null,
    repositoryUrl: null,
    repositoryId: null,
    baseBranch: "main",
    branch: "forge/pay-6-duplicate-charge",
    channelId: null,
    threadRootMessageId: null,
    resultSummary: null,
    discardedFiles: null,
    pullRequestId: null,
    pullRequestUrl: null,
    error: null,
    attempts: 1,
    maxAttempts: 3,
    eventCount: 12,
    approvals: [],
    createdAt: minutesAgo(14),
    updatedAt: minutesAgo(2),
    assignedAt: minutesAgo(13),
    startedAt: minutesAgo(13),
    completedAt: null,
    ...overrides,
  };
}

const approval: ApprovalEntity = {
  id: "ap-1",
  requestKey: "req-1",
  title: "Run the database migration on staging",
  detail: {
    tool: "bash",
    input: { command: "bun run db:migrate --env staging" },
    reason:
      "The idempotency key column must exist on staging before the retry test can run.",
  },
  status: "pending",
  decidedById: null,
  note: null,
  createdAt: minutesAgo(3),
  decidedAt: null,
};

const runner = { id: "r-1", name: "build-box-1" } as RunnerEntity;

export function DesignGallery() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Design system"
        icon={<Palette />}
        description="Lictory's shared building blocks, in light and dark. Not linked from the navigation."
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1280px] space-y-10 px-4 py-8 sm:px-8">
          <Section
            wide
            title="PageHeader"
            rule="One 44px bar starts every module page (48px on phones, merged with the shell's top bar). Back, breadcrumbs, title, an info button instead of a description, one meta line, link tabs, actions."
          >
            <HeaderExamples />
          </Section>
          <Section
            title="Identity"
            rule="People are circles in their own color, photos when they have one; under 20px a dot with a tooltip. Agents are rounded squares (a robot badge from 24px), always named via their owner's first name. Automated acts name the policy and who set it."
          >
            <IdentityExamples />
          </Section>
          <Section
            title="State"
            rule="StatusChip: 20px, 6px corners, sans 12px medium, an icon and a label, five tones. Session and claim states come from sessionState() only."
          >
            <StateExamples />
          </Section>
          <Section
            title="Panel and ListRow"
            rule="A Panel is a card of ListRows with a sans title and count; with no rows and nothing to teach it is not rendered. Section captions are sans 12px semibold muted; mono only for identifiers and code."
          >
            <RowExamples />
          </Section>
          <Section
            title="ApprovalRequest"
            rule="What is asked, who asks, where, and the evidence. In lists the action is Review; Approve appears only with the context. Only the person who started the session or the agent's owner decides."
          >
            <ApprovalExamples />
          </Section>
          <Section
            title="First run and missing data"
            rule="A page with no data at all is one MissingState with one primary action; zero stat cards and empty sections are hidden. Home's first run is a checklist derived from data that leaves once everything exists."
          >
            <EmptyExamples />
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  rule,
  wide = false,
  children,
}: {
  title: string;
  rule: string;
  // Light above dark, for examples that need the page's width.
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted-foreground">
        {rule}
      </p>
      <div
        className={wide ? "mt-4 grid gap-4" : "mt-4 grid gap-4 xl:grid-cols-2"}
      >
        <Themed theme="light">{children}</Themed>
        <Themed theme="dark">{children}</Themed>
      </div>
    </section>
  );
}

// The same examples on the light and the dark tokens. The dark copy is for
// the eye only: it is inert, so keyboard and screen reader users meet each
// example (and its landmarks) once.
function Themed({
  theme,
  children,
}: {
  theme: "light" | "dark";
  children: ReactNode;
}) {
  return (
    <div
      data-theme="lictory"
      data-gallery-theme={theme}
      inert={theme === "dark"}
      className={
        (theme === "dark" ? "dark " : "") +
        "min-w-0 rounded-2xl bg-shell p-4 text-foreground ring-1 ring-foreground/10"
      }
    >
      <p className="mb-3 text-xs font-semibold text-muted-foreground">
        {theme === "dark" ? "Dark" : "Light"}
      </p>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-background shadow-(--shadow-border)">
      {children}
    </div>
  );
}

function HeaderExamples() {
  const { organization } = useWorkspace();
  const org = organization.slug;
  return (
    // Examples, not this page's header: they do not take the phone bar.
    <PhoneChromeContext value={null}>
      <Frame>
        <PageHeader
          title="Inbox"
          icon={<Inbox />}
          actions={
            <Button size="sm" variant="secondary">
              <Plus className="size-3.5" aria-hidden /> New item
            </Button>
          }
        />
      </Frame>
      <Frame>
        <PageHeader
          title="Factory"
          icon={<Bot />}
          description="Agents working on your team's tasks, on runners you control."
          meta={<span>3 running · 1 queued</span>}
          tabs={
            <PageLinkTabs
              label="Factory (example)"
              tabs={[
                {
                  href: `/${org}/design-system`,
                  label: "Overview",
                  exact: true,
                },
                { href: `/${org}/design-system/agents`, label: "Agents" },
                { href: `/${org}/design-system/runners`, label: "Runners" },
              ]}
            />
          }
          actions={<Button size="sm">Start session</Button>}
        />
      </Frame>
      <Frame>
        <PageHeader
          title="PAY-6: Duplicate charge when the provider times out"
          back={{ label: "Back to the Factory", href: `/${org}/design-system` }}
          meta={
            <StatusChip tone="attention" icon={<MessageCircleQuestion />}>
              Waiting on Ada
            </StatusChip>
          }
          actions={
            <Button size="sm" variant="secondary">
              Interrupt
            </Button>
          }
        />
      </Frame>
    </PhoneChromeContext>
  );
}

const sizes: ActorSize[] = [16, 20, 24, 32, 36];

function IdentityExamples() {
  const ada = people[0]!;
  return (
    <>
      <Row label="People">
        {sizes.map((size) => (
          <PersonAvatar key={size} person={ada} size={size} />
        ))}
        {people.slice(1).map((p) => (
          <PersonAvatar key={p.id} person={p} size={24} />
        ))}
        <PersonAvatar person={slackPerson} size={24} />
      </Row>
      <Row label="Agents">
        {sizes.map((size) => (
          <AgentAvatar key={size} agent={forge} size={size} />
        ))}
        <AgentAvatar agent={sentry} size={24} />
        <AgentAvatar agent={scout} size={24} />
      </Row>
      <Row label="Names">
        <Actor person={ada} />
        <Actor person={people[1]} label="first" />
        <Actor person={slackPerson} />
      </Row>
      <Row label="Agent via owner">
        <AgentActor agent={forge} owner={ada} />
        <AgentActor agent={sentry} owner={people[1]} size={16} />
      </Row>
      <Row label="Policy">
        <PolicyActor level="build" setBy={ada} />
        <PolicyActor level="autopilot" setBy={people[2]} size={16} />
      </Row>
      <Row label="Facepile">
        <Facepile people={people.slice(0, 3)} label="3 members" />
        <Facepile
          people={[...people, { ...forge, agent: true as const }]}
          max={4}
          size={24}
          label="7 members"
        />
      </Row>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-3 text-[13px] shadow-(--shadow-border) [--actor-ring:var(--card)]">
      <span className="w-28 shrink-0 text-xs font-semibold text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

const tones: StatusTone[] = [
  "neutral",
  "info",
  "attention",
  "success",
  "danger",
  "merged",
];
const statuses: SessionStatus[] = [
  "queued",
  "assigned",
  "running",
  "waiting",
  "completed",
  "failed",
  "canceled",
];

function StateExamples() {
  return (
    <>
      <Row label="Tones">
        {tones.map((tone) => (
          <StatusChip key={tone} tone={tone}>
            {tone[0]!.toUpperCase() + tone.slice(1)}
          </StatusChip>
        ))}
      </Row>
      <Row label="Sessions">
        {statuses.map((status) => (
          <SessionStateChip key={status} state={sessionState({ status })} />
        ))}
      </Row>
      <Row label="Claims">
        <SessionStateChip
          state={sessionState(
            { status: "waiting" },
            {
              claim: { state: "active", waitingThreadIds: [] },
              decider: "Ada Lovelace",
            },
          )}
        />
        <SessionStateChip
          state={sessionState(null, {
            claim: { state: "waiting", waitingThreadIds: ["t"] },
          })}
        />
      </Row>
    </>
  );
}

function RowExamples() {
  const { organization } = useWorkspace();
  const org = organization.slug;
  const ada = people[0]!;
  return (
    <>
      <Panel
        title="Agents at work"
        icon={<Bot />}
        count={12}
        more={{ label: "Factory", href: `/${org}/design-system` }}
      >
        <ListRow
          href={`/${org}/design-system`}
          leading={<AgentAvatar agent={forge} />}
          identifier="PAY-6"
          title="Duplicate charge when the provider times out"
          meta={<AgentActor agent={forge} owner={ada} avatar={false} />}
          chips={
            <SessionStateChip
              state={sessionState({ status: "waiting" }, { decider: ada.name })}
            />
          }
          time={minutesAgo(2)}
        />
        <ListRow
          href={`/${org}/design-system`}
          leading={<AgentAvatar agent={sentry} />}
          identifier="PAY-10"
          title="Refund button in the merchant dashboard"
          meta={<PolicyActor level="build" setBy={ada} size={16} />}
          chips={
            <SessionStateChip state={sessionState({ status: "running" })} />
          }
          time={minutesAgo(9)}
          actions={
            <Button size="sm" variant="ghost">
              Interrupt
            </Button>
          }
        />
        <ListRow
          href={`/${org}/design-system`}
          leading={<FileText className="text-muted-foreground" />}
          title="Refund runbook"
          meta="Payments handbook"
          time={minutesAgo(120)}
        />
      </Panel>
      <Panel
        title="Waiting on you"
        icon={<Inbox />}
        count={0}
        empty="Nothing waits on you. Review requests, approvals and pull requests to merge appear here."
      />
      <div className="rounded-xl bg-card p-3 shadow-(--shadow-border)">
        <SectionCaption count={3} action={<Search className="size-3.5" />}>
          Waiting on you
        </SectionCaption>
        <p className="text-[13px] text-muted-foreground">
          A caption over rows outside a card.
        </p>
      </div>
    </>
  );
}

function ApprovalExamples() {
  const { userId, directory } = useWorkspace();
  const [answered, setAnswered] = useState<string | null>(null);
  // Someone else who decides the second request.
  const other = directory.members.find((m) => m.id !== userId)?.id ?? "p-ben";
  const agent = {
    ...forge,
    ownerId: userId,
  } as unknown as AgentEntity;
  const someoneElses = { ...forge, ownerId: other } as unknown as AgentEntity;
  const waiting = fakeSession("waiting", {
    approvals: [approval],
    requestedById: userId,
    pullRequestUrl: "https://github.com/northwind/payments/pull/3",
  });
  const decide = async (decision: "approve" | "deny" | "answer") => {
    await new Promise((r) => setTimeout(r, 300));
    setAnswered(
      decision === "approve"
        ? "Approved"
        : decision === "answer"
          ? "Answered"
          : "Denied",
    );
  };
  return (
    <>
      <Panel title="Agents ask you" icon={<MessageCircleQuestion />} count={2}>
        <ApprovalRequest
          compact
          session={waiting}
          approval={approval}
          agent={agent}
          runner={runner}
          onDecide={decide}
        />
        <ApprovalRequest
          compact
          session={{
            ...waiting,
            id: galleryIds.otherSession,
            requestedById: other,
          }}
          // A request naming no action is a question: answered in words.
          approval={{
            ...approval,
            id: "ap-2",
            title: "Which release branch should this go to?",
            detail: { tool: null, input: null, reason: null },
          }}
          agent={someoneElses}
          runner={runner}
          onDecide={decide}
        />
      </Panel>
      <ApprovalRequest
        session={waiting}
        approval={approval}
        agent={agent}
        runner={runner}
        onDecide={decide}
      />
      {answered && (
        <p role="status" className="text-xs text-muted-foreground">
          {answered} (example only: nothing was sent).
        </p>
      )}
    </>
  );
}

function EmptyExamples() {
  const { organization } = useWorkspace();
  const setup = setupSteps(
    {
      codeConnections: [{ status: "active" }],
      runners: [],
      agents: [],
      channels: [{ kind: "public", archivedAt: null }],
      members: 1,
      invited: 0,
      project: { key: "PAY" },
      workItems: 1,
    },
    organization.slug,
    true,
  );
  return (
    <>
      <SetupChecklist setup={setup} />
      <Frame>
        <div className="h-72">
          <MissingState
            headingLevel={2}
            icon={Bot}
            title="No agents yet"
            action={<Button size="sm">Create agent</Button>}
          >
            Agents work on your team’s tasks on runners you control. Create one,
            then mention it in a channel.
          </MissingState>
        </div>
      </Frame>
    </>
  );
}
