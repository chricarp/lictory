import { LoadingState } from "@lictory/ui/spinner";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";
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
  Segmented,
  Steps,
} from "@lictory/platform/components/workspace/onboarding-frame";
import { ProjectFields } from "@lictory/platform/components/workspace/onboarding";
import {
  draftKey,
  draftSchema,
  emptyDraft,
  steps,
  type Draft,
} from "@lictory/platform/components/workspace/onboarding-draft";

const readinessHints = {
  block: "Spec-backed work can’t start until every readiness check passes.",
  warn: "Work can start early; Lictory records what was missing.",
  off: "Readiness is shown but never gates starting work.",
};
const planningHints = {
  off: "A board and ranked backlog, no time boxes.",
  manual: "Your team starts and completes each sprint.",
  automatic: "Cycles roll over on a schedule; unfinished work carries forward.",
};
const estimateHints = {
  none: "Skip sizing work. Items have no estimates.",
  fibonacci:
    "Story points: 0, 1, 2, 3, 5, 8, 13, 21. Bigger gaps reflect more uncertainty in larger work. Points compare effort and complexity, not hours.",
  linear:
    "Points from 0 to 8 in equal steps. Use this for finer distinctions between similarly sized items. Points compare effort and complexity, not hours.",
  tshirt:
    "Sizes: XS, S, M, L, XL. Compare work from extra small to extra large without choosing a point number or estimating hours.",
};
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
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
    key: string;
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
          setDraft({
            ...parsed.data,
            step:
              legacy && parsed.data.step === steps.people
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
  const flow = external
    ? [steps.project, steps.delivery, steps.intelligence, steps.people]
    : [
        steps.project,
        steps.delivery,
        steps.planning,
        steps.intelligence,
        steps.people,
      ];
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
    [steps.planning]: Boolean(
      draft.estimateScale &&
      draft.iterationMode &&
      (draft.iterationMode !== "automatic" ||
        (draft.iterationWeeks && draft.iterationStartDay)),
    ),
    [steps.people]: true,
    [steps.intelligence]: true,
  };
  const setupValid = flow.every((s) => valid[s]);

  const sendInvites = async (recipients: string[]) => {
    const results: InviteResult[] = [];
    // Sequential keeps each Better Auth invitation and email attempt independent.
    for (const recipient of recipients) {
      try {
        const response = await fetch("/api/invitations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId: organization.id,
            recipient: recipient.replace(/^@/, ""),
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
  const finish = (key: string) => {
    try {
      sessionStorage.removeItem(storageKey);
      sessionStorage.removeItem(`${storageKey}:attempt`);
    } catch {}
    // The organization layout keeps setup in place until it is told it is
    // done; leaving only after the project's address is current keeps the
    // organization home from redirecting first.
    void navigator
      .navigate({
        href: paths.list(organization.slug, key, "epics"),
        replace: true,
      })
      .finally(finishSetup);
  };
  const retryInvites = async () => {
    if (!invited) return;
    setBusy(true);
    const failed = invited.results
      .filter((r) => r.error)
      .map((r) => r.recipient);
    const retried = await sendInvites(failed);
    const merged = invited.results.map(
      (r) => retried.find((x) => x.recipient === r.recipient) ?? r,
    );
    setInvited({ key: invited.key, results: merged });
    setBusy(false);
    if (merged.every((r) => !r.error)) finish(invited.key);
  };

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!attempt.current) {
        const setup = onboardingSetupSchema.parse({
          deliveryMode: draft.deliveryMode,
          readinessPolicy: draft.readinessPolicy,
          iterationMode: external ? "off" : draft.iterationMode,
          estimateScale: external ? "none" : draft.estimateScale,
          aiEnabled: draft.aiEnabled,
          iterationWeeks: Number(draft.iterationWeeks) || 2,
          iterationStartDay: Number(draft.iterationStartDay) || 0,
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
        const results = await sendInvites(draft.invites);
        if (results.some((r) => r.error)) {
          // The workspace exists; report each invitation instead of one failure.
          setInvited({ key: command.key, results });
          return;
        }
      }
      finish(command.key);
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
          <Button
            variant="ghost"
            size="lg"
            disabled={busy}
            onClick={() => finish(invited.key)}
          >
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
      labels={
        external
          ? ["Project", "Delivery", "Lictory Intelligence", "People"]
          : [
              "Project",
              "Delivery",
              "Planning",
              "Lictory Intelligence",
              "People",
            ]
      }
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
                  Specs are always refined and approved in Lictory.
                </OnboardingHeading>
                <CardOptions
                  label="Delivery"
                  value={draft.deliveryMode}
                  onChange={(deliveryMode) => update({ deliveryMode })}
                  options={[
                    {
                      value: "native",
                      title: "In Lictory",
                      description:
                        "Boards, backlog and iterations next to specs.",
                      icon: <SquareKanban />,
                    },
                    {
                      value: "external",
                      title: "In Jira",
                      description:
                        "Export ready work. Jira owns status and sprints.",
                      icon: <Send />,
                    },
                  ]}
                />
                <Reveal show={draft.deliveryMode === "native"}>
                  <div className="pt-8">
                    <Segmented
                      label="When work starts before it’s ready"
                      value={draft.readinessPolicy}
                      onChange={(readinessPolicy) =>
                        update({ readinessPolicy })
                      }
                      options={[
                        { value: "block", label: "Block" },
                        { value: "warn", label: "Warn" },
                        { value: "off", label: "Allow" },
                      ]}
                      hint={readinessHints[draft.readinessPolicy]}
                    />
                  </div>
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
            {draft.step === steps.planning && (
              <>
                <OnboardingHeading title="How does the project plan?" />
                <div className="space-y-8">
                  <div>
                    <Segmented
                      label="Cadence"
                      value={draft.iterationMode}
                      onChange={(iterationMode) => update({ iterationMode })}
                      options={[
                        { value: "off", label: "Continuous" },
                        { value: "manual", label: "Sprints" },
                        { value: "automatic", label: "Cycles" },
                      ]}
                      hint={
                        draft.iterationMode
                          ? planningHints[draft.iterationMode]
                          : "Pick one to continue."
                      }
                    />
                    <Reveal show={draft.iterationMode === "automatic"}>
                      <div className="grid grid-cols-2 gap-3 pt-4">
                        <Select
                          label="Length"
                          value={draft.iterationWeeks}
                          onChange={(iterationWeeks) =>
                            update({ iterationWeeks })
                          }
                          options={Array.from({ length: 8 }, (_, i) => [
                            String(i + 1),
                            `${i + 1} week${i ? "s" : ""}`,
                          ])}
                        />
                        <Select
                          label="Starts on"
                          value={draft.iterationStartDay}
                          onChange={(iterationStartDay) =>
                            update({ iterationStartDay })
                          }
                          options={days.map((name, i) => [String(i), name])}
                        />
                      </div>
                    </Reveal>
                  </div>
                  <Segmented
                    label="Estimates"
                    value={draft.estimateScale}
                    onChange={(estimateScale) => update({ estimateScale })}
                    options={[
                      { value: "none", label: "None" },
                      { value: "fibonacci", label: "Fibonacci" },
                      { value: "linear", label: "Linear" },
                      { value: "tshirt", label: "T-shirt" },
                    ]}
                    hint={
                      draft.estimateScale
                        ? estimateHints[draft.estimateScale]
                        : "Choose how your team compares the size of work: story points, T-shirt sizes, or no estimates. Select a scale to see examples."
                    }
                  />
                </div>
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
                  value={draft.aiEnabled ? "enabled" : "disabled"}
                  onChange={(value) =>
                    update({ aiEnabled: value === "enabled" })
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
                      Lictory Intelligence is not available on this server yet.
                      Your choice will be saved and it can run once a provider
                      is configured.
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
                  onChange={(invites) => update({ invites })}
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
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
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
      <ul aria-label="People to invite" className="mt-2 flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {value.map((r) => (
            <motion.li
              key={r}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.16 }}
              className="flex h-8 items-center gap-1 rounded-full border bg-card pr-1 pl-3 text-[13px]"
            >
              <span className="max-w-[220px] truncate">{r}</span>
              <button
                type="button"
                aria-label={`Remove ${r}`}
                onClick={() => onChange(value.filter((v) => v !== r))}
                className="grid size-6 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="size-3.5" />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {value.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          They join the organization as members. Add them to the project’s
          disciplines once they’re in.
        </p>
      )}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <DropdownSelect
        value={value}
        required
        onValueChange={(value) => onChange(value)}
        size="lg"
        className="mt-2 w-full"
        aria-label={label}
      >
        {options.map(([value, label]) => (
          <DropdownSelectOption key={value} value={value}>
            {label}
          </DropdownSelectOption>
        ))}
      </DropdownSelect>
    </label>
  );
}
