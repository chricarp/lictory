import { LoadingState } from "@lictory/ui/spinner";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter as useTanStackRouter } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Send,
  SquareKanban,
  Users,
  X,
} from "lucide-react";
import { IntelligenceMark } from "@lictory/ui/intelligence-mark";
import { z } from "zod";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
import {
  PROTOCOL,
  mutationSchema,
  onboardingSetupSchema,
  type Mutation,
} from "@lictory/core/contracts/protocol";
import { suggestKey } from "@lictory/core/lib/work-items";
import { handleProblem, normalizeHandle } from "@lictory/core/lib/handles";
import { paths } from "@lictory/core/lib/paths";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { MutationRejected } from "@lictory/platform/data/mutations";
import { useFinishSetup } from "@lictory/platform/routes/organization";
import {
  CardOptions,
  OnboardingFrame,
  OnboardingHeading,
  Reveal,
  Steps,
  setupLabels,
} from "@lictory/platform/components/workspace/onboarding-frame";
import { ProjectFields } from "@lictory/platform/components/workspace/onboarding";
import {
  defaultInviteDiscipline,
  draftKey,
  draftSchema,
  emptyDraft,
  inviteDisciplineNames,
  steps,
  type Draft,
  type InviteDiscipline,
} from "@lictory/platform/components/workspace/onboarding-draft";

const isEmail = (v: string) => z.email().safeParse(v).success;
function parseRecipient(raw: string): string | undefined {
  const value = raw.trim().toLowerCase();
  if (!value) return;
  if (isEmail(value)) return value;
  const handle = normalizeHandle(value);
  return handle && !handleProblem(handle) ? `@${handle}` : undefined;
}

type InviteResult = { recipient: string; error?: string };

export function OnboardingSetup({ canCreate = true }: { canCreate?: boolean }) {
  const { organization, userId, directory, reconnect, applyConfirmed } =
    useWorkspace();
  const finishSetup = useFinishSetup();
  const navigator = useTanStackRouter();
  const storageKey = draftKey(userId, organization.id);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [direction, setDirection] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const attempt = useRef<Mutation | undefined>(undefined);
  const [uncertain, setUncertain] = useState(false);
  // Setup is saved; these invitations still need delivery confirmation.
  const [invited, setInvited] = useState<{
    projectId: string;
    results: InviteResult[];
  }>();
  const container = useRef<HTMLFormElement>(null);
  const previousStep = useRef(draft.step);
  // Restore a browser-only draft after hydration; do not read another user's partition.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const raw: unknown = JSON.parse(saved);
        const parsed = draftSchema.safeParse(raw);
        if (parsed.success) {
          // A draft from before this choice must show it before enabling
          // Lictory Intelligence.
          const legacy = !z.object({ aiEnabled: z.boolean() }).safeParse(raw)
            .success;
          // Planning is no longer asked; a draft saved there resumes at
          // the next question.
          setDraft({
            ...parsed.data,
            step:
              (legacy && parsed.data.step === steps.people) ||
              parsed.data.step === steps.planning
                ? steps.intelligence
                : parsed.data.step,
          });
        }
      }
      const submitted = sessionStorage.getItem(`${storageKey}:attempt`);
      if (submitted) {
        const parsed = mutationSchema.safeParse(JSON.parse(submitted));
        if (
          parsed.success &&
          parsed.data.organizationId === organization.id &&
          parsed.data.command.type === "createProject" &&
          parsed.data.command.setup
        ) {
          attempt.current = parsed.data;
          setUncertain(true);
          setDraft((d) => ({ ...d, step: steps.people }));
        }
      }
    } catch {
      /* Storage is optional; server decisions remain authoritative. */
    }
    setLoaded(true);
  }, [storageKey, organization.id]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (loaded) {
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(draft));
      } catch {
        /* Private browsers may disable storage. */
      }
    }
  }, [loaded, draft, storageKey]);
  useEffect(() => {
    if (previousStep.current !== draft.step)
      container.current?.querySelector("h1")?.focus({ preventScroll: true });
    previousStep.current = draft.step;
  }, [draft.step]);
  const update = (patch: Partial<Draft>) =>
    setDraft((d) => ({ ...d, ...patch }));
  const external = draft.deliveryMode === "external";
  const flow = [
    steps.project,
    steps.delivery,
    steps.intelligence,
    steps.people,
  ];
  // Until the person chooses, Lictory Intelligence follows the server: on
  // an installation without an AI provider it starts off.
  const aiEnabled = draft.aiChosen ? draft.aiEnabled : directory.ai.available;
  const position = Math.max(0, flow.indexOf(draft.step as never));
  const go = (offset: number) => {
    const next = flow[position + offset];
    if (next === undefined) return;
    setDirection(Math.sign(offset));
    setError(undefined);
    update({ step: next });
  };
  const effectiveKey = draft.keyTouched ? draft.key : suggestKey(draft.name);
  const valid = {
    [steps.project]: Boolean(
      draft.name.trim() && /^[A-Z][A-Z0-9]{1,9}$/.test(effectiveKey),
    ),
    [steps.delivery]: Boolean(draft.deliveryMode),
    [steps.people]: true,
    [steps.intelligence]: true,
  };
  const setupValid = flow.every((s) => valid[s]);

  // The project's disciplines arrive through synchronization shortly after
  // the server created it; an invitation names one by its id.
  const latestDirectory = useRef(directory);
  useEffect(() => {
    latestDirectory.current = directory;
  }, [directory]);
  const projectDisciplines = async (projectId: string) => {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const found = latestDirectory.current.disciplines.filter(
        (d) => d.projectId === projectId && !d.archivedAt,
      );
      if (found.length || Date.now() > deadline) return found;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };

  // Invited people join the first project in the discipline chosen for
  // them, so their first screen is its work and reviews can be asked of
  // them, not an organization they cannot do anything in yet.
  const sendInvites = async (recipients: string[], projectId: string) => {
    const results: InviteResult[] = [];
    const chosen = (recipient: string) =>
      draft.inviteDisciplines[recipient] ?? defaultInviteDiscipline;
    const disciplines = recipients.some((r) => chosen(r))
      ? await projectDisciplines(projectId)
      : [];
    // Sequential keeps each Better Auth invitation and email attempt independent.
    for (const recipient of recipients) {
      try {
        const response = await fetch("/api/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: organization.id,
            recipient: recipient.replace(/^@/, ""),
            placement: {
              projectId,
              disciplineIds: disciplines
                .filter((d) => d.name === chosen(recipient))
                .map((d) => d.id),
            },
          }),
        });
        const body: unknown = await response.json().catch(() => null);
        results.push(
          response.ok
            ? { recipient }
            : {
                recipient,
                error:
                  z
                    .object({ error: z.object({ message: z.string() }) })
                    .safeParse(body).data?.error.message ??
                  "The invitation could not be sent.",
              },
        );
      } catch {
        results.push({
          recipient,
          error: "Check your connection and retry.",
        });
      }
    }
    return results;
  };
  const finish = () => {
    try {
      sessionStorage.removeItem(storageKey);
      sessionStorage.removeItem(`${storageKey}:attempt`);
    } catch {}
    // Setup ends on Home, whose checklist carries on where setup stops
    // (code host, runner, agent). The organization layout keeps setup in
    // place until it is told it is done.
    void navigator
      .navigate({ href: paths.org(organization.slug), replace: true })
      .finally(finishSetup);
  };
  const retryInvites = async () => {
    if (!invited) return;
    setBusy(true);
    const failed = invited.results
      .filter((r) => r.error)
      .map((r) => r.recipient);
    const retried = await sendInvites(failed, invited.projectId);
    const merged = invited.results.map(
      (r) => retried.find((x) => x.recipient === r.recipient) ?? r,
    );
    setInvited({ projectId: invited.projectId, results: merged });
    setBusy(false);
    if (merged.every((r) => !r.error)) finish();
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!attempt.current) {
        // Planning and readiness start from strong defaults (continuous
        // flow, story points, warn when work starts early); the project's
        // settings change them once the team has met them.
        const setup = onboardingSetupSchema.parse({
          deliveryMode: draft.deliveryMode,
          readinessPolicy: "warn",
          iterationMode: "off",
          estimateScale: external ? "none" : "fibonacci",
          aiEnabled,
          iterationWeeks: 2,
          iterationStartDay: 1,
          invitations: draft.invites.length,
        });
        attempt.current = mutationSchema.parse({
          protocol: PROTOCOL,
          id: crypto.randomUUID(),
          organizationId: organization.id,
          command: {
            type: "createProject",
            projectId: crypto.randomUUID(),
            name: draft.name.trim(),
            key: effectiveKey,
            setup,
          },
        });
        try {
          sessionStorage.setItem(
            `${storageKey}:attempt`,
            JSON.stringify(attempt.current),
          );
        } catch {
          /* In-memory retry still retains the same id. */
        }
      }
      setUncertain(true);
      try {
        // The same mutation ID makes a retry after an unclear outcome
        // idempotent: the server answers from its receipt.
        await applyConfirmed(attempt.current);
      } catch (e) {
        // A definitive domain answer: the next attempt is a new mutation.
        if (
          e instanceof MutationRejected &&
          e.details.category !== "unavailable" &&
          e.details.category !== "server"
        ) {
          attempt.current = undefined;
          setUncertain(false);
          try {
            sessionStorage.removeItem(`${storageKey}:attempt`);
          } catch {}
        }
        throw e;
      }
      const command = attempt.current.command;
      if (command.type !== "createProject") return;
      if (draft.invites.length) {
        const results = await sendInvites(draft.invites, command.projectId);
        if (results.some((r) => r.error)) {
          // The workspace exists; report each invitation instead of one failure.
          setInvited({ projectId: command.projectId, results });
          return;
        }
      }
      finish();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save setup. Check your connection and retry.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!canCreate)
    return (
      <OnboardingFrame title={`Set up ${organization.name} · Lictory`}>
        <OnboardingHeading title="Almost there">
          An administrator is finishing setup for {organization.name}. You’ll
          land in the workspace as soon as it’s ready.
        </OnboardingHeading>
        <Button size="lg" variant="secondary" onClick={reconnect}>
          Check again
        </Button>
      </OnboardingFrame>
    );
  if (!loaded)
    return (
      <OnboardingFrame title={`Set up ${organization.name} · Lictory`}>
        <LoadingState label="Opening your setup" />
      </OnboardingFrame>
    );
  if (invited) {
    const failed = invited.results.filter((r) => r.error);
    const sent = invited.results.length - failed.length;
    return (
      <OnboardingFrame title={`Set up ${organization.name} · Lictory`}>
        <OnboardingHeading
          title={`${failed.length} invitation${failed.length === 1 ? "" : "s"} not sent`}
        >
          {organization.name} is ready.{" "}
          {sent > 0 &&
            `${sent} of ${invited.results.length} invitations were sent. `}
          Retry the rest or invite them later from settings.
        </OnboardingHeading>
        <ul className="mb-8 divide-y rounded-xl border">
          {failed.map((r) => (
            <li key={r.recipient} className="px-4 py-3 text-sm">
              <p className="font-medium break-all">{r.recipient}</p>
              <p className="mt-0.5 text-xs text-destructive">{r.error}</p>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="lg" disabled={busy} onClick={finish}>
            Continue without them
          </Button>
          <Button size="lg" disabled={busy} onClick={() => void retryInvites()}>
            {busy ? "Sending…" : "Retry"}
          </Button>
        </div>
      </OnboardingFrame>
    );
  }
  const last = position === flow.length - 1;
  return (
    <OnboardingFrame
      title={`Set up ${organization.name} · Lictory`}
      stage={position}
      labels={setupLabels}
    >
      <form
        ref={container}
        onSubmit={(e) => {
          e.preventDefault();
          if (last) {
            if (setupValid || uncertain) void submit();
          } else if (valid[draft.step as keyof typeof valid]) go(1);
        }}
      >
        <fieldset disabled={busy || uncertain} className="min-w-0">
          <Steps step={draft.step} direction={direction}>
            {draft.step === steps.project && (
              <>
                <OnboardingHeading title="Your first project" />
                <ProjectFields
                  name={draft.name}
                  projectKey={effectiveKey}
                  onName={(name) => update({ name })}
                  onKey={(key) => update({ key, keyTouched: true })}
                />
              </>
            )}
            {draft.step === steps.delivery && (
              <>
                <OnboardingHeading title="Where does delivery happen?">
                  Specs are always refined and approved in Lictory. You can
                  change this later in the project’s settings.
                </OnboardingHeading>
                <CardOptions
                  label="Delivery"
                  value={draft.deliveryMode}
                  onChange={(deliveryMode) => update({ deliveryMode })}
                  options={[
                    {
                      value: "native",
                      title: "Deliver in Lictory",
                      description:
                        "Boards, backlog and iterations next to specs.",
                      icon: <SquareKanban />,
                    },
                    {
                      value: "external",
                      title: "Hand off to Jira",
                      description:
                        "Hand off ready work. Jira owns status and sprints.",
                      icon: <Send />,
                    },
                  ]}
                />
                <Reveal show={draft.deliveryMode === "native"}>
                  <p className="pt-6 text-xs leading-relaxed text-muted-foreground">
                    The project starts with a board and a ranked backlog, story
                    points, and work that may start before its specification is
                    ready (Lictory records what was missing). Sprints, cycles
                    and the readiness policy are in the project’s settings.
                  </p>
                </Reveal>
                <Reveal show={external}>
                  <p className="pt-6 text-xs leading-relaxed text-muted-foreground">
                    Export requires every readiness check to pass. Once you’re
                    in, connect Jira in organization settings → Integrations,
                    then pick the Jira project in the project’s delivery
                    settings.
                  </p>
                </Reveal>
              </>
            )}
            {draft.step === steps.intelligence && (
              <>
                <OnboardingHeading title="Lictory Intelligence">
                  Choose whether your organization uses Lictory Intelligence to
                  help refine specs.
                </OnboardingHeading>
                <CardOptions
                  label="Lictory Intelligence"
                  value={aiEnabled ? "enabled" : "disabled"}
                  onChange={(value) =>
                    update({ aiEnabled: value === "enabled", aiChosen: true })
                  }
                  options={[
                    {
                      value: "enabled",
                      title: "Enable Lictory Intelligence",
                      description:
                        "Chat with Litto, your assistant powered by Lictory Intelligence, spot gaps and contradictions in AI reviews, and get suggested fixes to review changes.",
                      icon: <IntelligenceMark />,
                    },
                    {
                      value: "disabled",
                      title: "Keep Lictory Intelligence off",
                      description:
                        "No Litto assistant, automated reviews or suggested fixes. Write specs, discuss, review and approve with your team.",
                      icon: <Users />,
                    },
                  ]}
                />
                <div className="mt-6 space-y-3 text-xs leading-relaxed text-muted-foreground">
                  <p>
                    Lictory Intelligence proposes changes. People decide what to
                    accept and approve.
                  </p>
                  <p>
                    Enabling Lictory Intelligence allows relevant specs,
                    discussions and organization context to be sent to the
                    configured AI provider when it runs. With Lictory
                    Intelligence off, no content is sent to an AI provider.
                  </p>
                  {!directory.ai.available && (
                    <p>
                      This server has no AI provider configured yet, so Lictory
                      Intelligence starts off. If you enable it, it runs once an
                      operator configures a provider.
                    </p>
                  )}
                  <p>
                    An organization administrator can change this later in
                    organization settings → Lictory Intelligence.
                  </p>
                </div>
              </>
            )}
            {draft.step === steps.people && (
              <>
                <OnboardingHeading
                  title={`Invite people to ${organization.name}`}
                >
                  Specs get better with engineering and QA in the loop. You can
                  skip this and invite people later from organization settings.
                </OnboardingHeading>
                <Invites
                  value={draft.invites}
                  disciplines={draft.inviteDisciplines}
                  project={draft.name.trim() || "the project"}
                  onChange={(invites) => update({ invites })}
                  onDiscipline={(recipient, discipline) =>
                    update({
                      inviteDisciplines: {
                        ...draft.inviteDisciplines,
                        [recipient]: discipline,
                      },
                    })
                  }
                />
              </>
            )}
          </Steps>
        </fieldset>
        <AnimatePresence initial={false}>
          {(uncertain || error) && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role={error ? "alert" : "status"}
              className={
                error
                  ? "mt-6 text-sm text-destructive"
                  : "mt-6 text-sm text-muted-foreground"
              }
            >
              {error ??
                "Your setup may already be saved. Confirm to finish safely."}
            </motion.p>
          )}
        </AnimatePresence>
        <div className="mt-10 flex items-center justify-between gap-3">
          {position > 0 ? (
            <Button
              variant="ghost"
              size="lg"
              className="-ml-3"
              disabled={busy || uncertain}
              onClick={() => go(-1)}
            >
              <ArrowLeft className="size-4" />
              Back
            </Button>
          ) : (
            <span />
          )}
          <Button
            type="submit"
            size="lg"
            disabled={
              busy ||
              (!uncertain &&
                (last ? !setupValid : !valid[draft.step as keyof typeof valid]))
            }
          >
            {busy
              ? "Setting up…"
              : uncertain
                ? "Confirm setup"
                : last
                  ? draft.invites.length
                    ? `Invite ${draft.invites.length} and finish`
                    : "Skip and finish"
                  : "Continue"}
            {!busy && <ArrowRight className="size-4" />}
          </Button>
        </div>
      </form>
    </OnboardingFrame>
  );
}

function Invites({
  value,
  disciplines,
  project,
  onChange,
  onDiscipline,
}: {
  value: string[];
  disciplines: Record<string, InviteDiscipline>;
  project: string;
  onChange: (value: string[]) => void;
  onDiscipline: (recipient: string, discipline: InviteDiscipline) => void;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string>();
  const add = () => {
    const parts = text.split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) return;
    const parsed = parts.map(parseRecipient);
    const bad = parts.filter((_, i) => !parsed[i]);
    const next = [
      ...value,
      ...parsed.filter((r): r is string => r !== undefined),
    ];
    onChange([...new Set(next)].slice(0, 50));
    setText(bad.join(" "));
    setProblem(
      bad.length ? `Not an email or username: ${bad.join(", ")}` : undefined,
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || (e.key === " " && text.trim())) {
      if (!text.trim()) return;
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !text && value.length)
      onChange(value.slice(0, -1));
  };
  return (
    <div>
      <label htmlFor="invite" className="mb-2 block text-sm font-medium">
        Emails or usernames
      </label>
      <div className="flex gap-2">
        <Input
          id="invite"
          value={text}
          autoComplete="off"
          placeholder="ana@company.com, @lee"
          aria-invalid={problem ? true : undefined}
          aria-describedby="invite-problem"
          onChange={(e) => {
            setText(e.target.value);
            setProblem(undefined);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => text.trim() && add()}
        />
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={!text.trim()}
          onClick={add}
        >
          Add
        </Button>
      </div>
      <p
        id="invite-problem"
        aria-live="polite"
        className="mt-2 min-h-4 text-xs text-destructive"
      >
        {problem}
      </p>
      <ul aria-label="People to invite" className="mt-2 divide-y">
        <AnimatePresence initial={false}>
          {value.map((r) => (
            <motion.li
              key={r}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="flex min-h-11 items-center gap-2 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">{r}</span>
              <DropdownSelect
                size="sm"
                className="w-36 shrink-0"
                aria-label={`Discipline for ${r}`}
                value={disciplines[r] ?? defaultInviteDiscipline}
                onValueChange={(next) =>
                  onDiscipline(
                    r,
                    inviteDisciplineNames.find((d) => d === next) ?? "",
                  )
                }
              >
                {inviteDisciplineNames.map((d) => (
                  <DropdownSelectOption key={d} value={d}>
                    {d}
                  </DropdownSelectOption>
                ))}
                <DropdownSelectOption value="">
                  No discipline
                </DropdownSelectOption>
              </DropdownSelect>
              <button
                type="button"
                aria-label={`Remove ${r}`}
                onClick={() => onChange(value.filter((v) => v !== r))}
                className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-4" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {value.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          They join {project} in the discipline you choose: Product writes and
          decides specifications, Engineering and QA review them. Without a
          discipline they can read and discuss, and an administrator gives them
          one later in the project’s settings → Members.
        </p>
      )}
    </div>
  );
}
