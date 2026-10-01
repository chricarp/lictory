"use client";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "~/components/ui/dropdown-select";
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type InputHTMLAttributes,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  PROTOCOL,
  mutationSchema,
  onboardingSetupSchema,
  type Mutation,
} from "~/sync/shared/protocol";
import { suggestKey } from "~/lib/work-items";
import { paths } from "~/lib/paths";
import { useWorkspace } from "./provider";
import { OnboardingFrame, OnboardingHeading, Choice } from "./onboarding-frame";

const draftSchema = z.object({
  step: z.number().int().min(0).max(3),
  name: z.string().max(120),
  key: z.string().max(10),
  keyTouched: z.boolean(),
  teamName: z.string().max(60),
  deliveryMode: z.enum(["", "native", "external"]),
  readinessPolicy: z.enum(["", "off", "warn", "block"]),
  iterationMode: z.enum(["", "off", "manual", "automatic"]),
  estimateScale: z.enum(["", "none", "fibonacci", "linear", "tshirt"]),
  iterationWeeks: z.string(),
  iterationStartDay: z.string(),
});
type Draft = z.infer<typeof draftSchema>;
const emptyDraft: Draft = {
  step: 0,
  name: "",
  key: "",
  keyTouched: false,
  teamName: "",
  deliveryMode: "",
  readinessPolicy: "",
  iterationMode: "",
  estimateScale: "",
  iterationWeeks: "",
  iterationStartDay: "",
};
const policyLabels = {
  off: "Inform only",
  warn: "Warn before starting",
  block: "Require readiness",
};
const planningLabels = {
  off: "Continuous flow",
  manual: "Manual sprints",
  automatic: "Automatic cycles",
};
const estimateLabels = {
  none: "No estimates",
  fibonacci: "Fibonacci points",
  linear: "Linear points",
  tshirt: "T-shirt sizes",
};

export function OnboardingSetup({ canCreate = true }: { canCreate?: boolean }) {
  const { organization, userId, directory, engine } = useWorkspace();
  const router = useRouter();
  const storageKey = `lictory:setup:${userId}:${organization.id}`;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const attempt = useRef<Mutation | undefined>(undefined);
  const [uncertain, setUncertain] = useState(false);
  const heading = useRef<HTMLDivElement>(null);
  const previousStep = useRef(0);
  // Restore a browser-only draft after hydration; do not read another user's partition.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed = draftSchema.safeParse(JSON.parse(saved));
        if (parsed.success) setDraft(parsed.data);
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
          setDraft((d) => ({ ...d, step: 3 }));
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
      heading.current?.querySelector("h1")?.focus();
    previousStep.current = draft.step;
  }, [draft.step]);
  const update = (patch: Partial<Draft>) =>
    setDraft((d) => ({ ...d, ...patch }));
  const team = directory.teams.find((t) => !t.archivedAt);
  const effectiveKey = draft.keyTouched ? draft.key : suggestKey(draft.name);
  const identityValid =
    draft.name.trim() &&
    draft.teamName.trim() &&
    /^[A-Z][A-Z0-9]{1,9}$/.test(effectiveKey);
  const deliveryValid = draft.deliveryMode && draft.readinessPolicy;
  const planningValid =
    draft.estimateScale &&
    draft.iterationMode &&
    (draft.iterationMode !== "automatic" ||
      (draft.iterationWeeks && draft.iterationStartDay));
  const setupValid = Boolean(identityValid && deliveryValid && planningValid);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (!attempt.current) {
        if (!team)
          throw new Error(
            "The starter team is unavailable. Reload to try again.",
          );
        const setup = onboardingSetupSchema.parse({
          teamId: team.id,
          teamName: draft.teamName.trim(),
          deliveryMode: draft.deliveryMode,
          readinessPolicy: draft.readinessPolicy,
          iterationMode:
            draft.deliveryMode === "external" ? "off" : draft.iterationMode,
          estimateScale:
            draft.deliveryMode === "external" ? "none" : draft.estimateScale,
          iterationWeeks:
            draft.iterationMode === "automatic"
              ? Number(draft.iterationWeeks)
              : 2,
          iterationStartDay:
            draft.iterationMode === "automatic"
              ? Number(draft.iterationStartDay)
              : 1,
          acceptStarterConfiguration: true,
          deferInvitations: true,
          deferIntegration: true,
          deferAdvancedConfiguration: true,
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
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(attempt.current),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          attempt.current = undefined;
          setUncertain(false);
          try {
            sessionStorage.removeItem(`${storageKey}:attempt`);
          } catch {}
        }
        throw new Error(
          z.object({ error: z.object({ message: z.string() }) }).safeParse(body)
            .data?.error.message ?? "Setup could not be saved. Try again.",
        );
      }
      // Read through synchronization; a mutation receipt never advances a checkpoint.
      await engine.sync();
      const command = attempt.current.command;
      if (command.type !== "createProject") return;
      try {
        sessionStorage.removeItem(storageKey);
        sessionStorage.removeItem(`${storageKey}:attempt`);
      } catch {}
      router.replace(paths.list(organization.slug, command.key, "epics"));
      router.refresh();
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
      <OnboardingFrame
        stage={1}
        title={`Set up ${organization.name} · Lictory`}
      >
        <OnboardingHeading title="Workspace setup pending">
          An organization administrator needs to finish the first project and
          team setup. You’ll use their configuration, so there’s nothing you
          need to choose here.
        </OnboardingHeading>
        <Button size="lg" onClick={() => router.refresh()}>
          Check workspace setup
        </Button>
        <p className="mt-5 text-sm text-muted-foreground">
          Ask your administrator to finish setup for {organization.name}.
        </p>
      </OnboardingFrame>
    );
  if (!loaded)
    return (
      <OnboardingFrame title={`Set up ${organization.name} · Lictory`}>
        <p role="status" className="text-sm text-muted-foreground">
          Opening your setup…
        </p>
      </OnboardingFrame>
    );
  return (
    <OnboardingFrame
      title={`Set up ${organization.name} · Lictory`}
      stage={
        draft.deliveryMode === "external" && draft.step === 3 ? 2 : draft.step
      }
      labels={
        draft.deliveryMode === "external"
          ? ["Project & team", "Delivery", "Review"]
          : ["Project & team", "Delivery", "Planning", "Review"]
      }
    >
      <div key={draft.step} className="onboarding-step" ref={heading}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.step === 3) {
              if (setupValid || uncertain) void submit();
            } else if (
              draft.step === 0
                ? identityValid
                : draft.step === 1
                  ? deliveryValid
                  : planningValid
            )
              update({
                step:
                  draft.step === 1 && draft.deliveryMode === "external"
                    ? 3
                    : draft.step + 1,
              });
          }}
        >
          <fieldset disabled={busy || uncertain} className="min-w-0">
            {draft.step === 0 && (
              <>
                <OnboardingHeading title="Add your first project">
                  Projects organize specifications and give work stable
                  identifiers. Teams own delivery settings.
                </OnboardingHeading>
                <div className="space-y-5">
                  <Field
                    label="Project name"
                    hint="The product or area you’re building, such as Payments."
                  >
                    <Input
                      name="name"
                      value={draft.name}
                      maxLength={120}
                      required
                      placeholder="Payments"
                      onChange={(e) => update({ name: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Key"
                    hint={`2–10 letters or digits. Your items will be ${effectiveKey || "PAY"}-1, ${effectiveKey || "PAY"}-2… Choose carefully: this is their lasting identity.`}
                  >
                    <Input
                      name="key"
                      value={effectiveKey}
                      pattern="[A-Z][A-Z0-9]{1,9}"
                      maxLength={10}
                      required
                      placeholder="PAY"
                      className="font-mono uppercase"
                      onChange={(e) =>
                        update({
                          keyTouched: true,
                          key: e.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9]/g, ""),
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="Team name"
                    hint="The people delivering the work. Team membership organizes people; roles grant permissions."
                  >
                    <Input
                      value={draft.teamName}
                      required
                      maxLength={60}
                      placeholder="Payments team"
                      onChange={(e) => update({ teamName: e.target.value })}
                    />
                  </Field>
                </div>
              </>
            )}
            {draft.step === 1 && (
              <>
                <OnboardingHeading title="Where will your team deliver?">
                  Review and approval always happen in Lictory. Choose which
                  system owns delivery for {draft.teamName}. You can change this
                  later in team settings.
                </OnboardingHeading>
                <div className="space-y-3">
                  <Choice
                    title="Refine and deliver in Lictory"
                    selected={draft.deliveryMode === "native"}
                    onClick={() =>
                      update({
                        deliveryMode: "native",
                        iterationMode: "",
                        estimateScale: "",
                      })
                    }
                  >
                    Specifications, boards, backlog, and iterations in one
                    place.
                  </Choice>
                  <Choice
                    title="Refine here, deliver in Jira"
                    selected={draft.deliveryMode === "external"}
                    onClick={() =>
                      update({
                        deliveryMode: "external",
                        iterationMode: "off",
                        estimateScale: "none",
                      })
                    }
                  >
                    Review specifications here, then explicitly export ready
                    work to Jira Cloud. Jira owns status, assignees, and
                    sprints. Connect it later.
                  </Choice>
                </div>
                <fieldset className="mt-7 space-y-2">
                  <legend className="mb-2 text-sm font-medium">
                    {draft.deliveryMode === "external"
                      ? "Readiness"
                      : "What if work starts before it’s ready?"}
                  </legend>
                  <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
                    Readiness comes from acceptance criteria, reviews, and
                    resolved blockers.{" "}
                    {draft.deliveryMode === "external"
                      ? "Jira export always requires readiness. Choose how readiness is treated if this team switches to native delivery later."
                      : "Choose how strongly those checks gate starting spec-backed work. Ordinary tasks are not gated."}
                  </p>
                  {(
                    [
                      [
                        "block",
                        "Require readiness",
                        "Prevent starting until every readiness check passes.",
                      ],
                      [
                        "warn",
                        "Warn before starting",
                        "Allow starting and record the missing readiness evidence.",
                      ],
                      [
                        "off",
                        "Inform only",
                        "Show readiness without gating or recording an early start.",
                      ],
                    ] as const
                  ).map(([value, title, description]) => (
                    <Choice
                      key={value}
                      title={title}
                      selected={draft.readinessPolicy === value}
                      onClick={() => update({ readinessPolicy: value })}
                    >
                      {description}
                    </Choice>
                  ))}
                </fieldset>
              </>
            )}
            {draft.step === 2 && (
              <>
                <OnboardingHeading
                  title={
                    draft.deliveryMode === "external"
                      ? "Delivery planning"
                      : "Plan your work"
                  }
                >
                  {draft.deliveryMode === "external"
                    ? "Your delivery tool owns planning and estimates. Lictory keeps revisions, reviews, decisions, and readiness together."
                    : "Choose how to plan and estimate delivery. These choices are reversible, and you won’t need to create an iteration right now."}
                </OnboardingHeading>
                {draft.deliveryMode === "native" && (
                  <>
                    <fieldset className="space-y-2">
                      <legend className="mb-3 text-sm font-medium">
                        Planning
                      </legend>
                      {(
                        [
                          [
                            "off",
                            "Continuous flow",
                            "Use a board and ranked backlog without time boxes.",
                          ],
                          [
                            "manual",
                            "Manual sprints",
                            "Your team starts and completes each sprint explicitly.",
                          ],
                          [
                            "automatic",
                            "Automatic cycles",
                            "Cycles open and close on a schedule; unfinished work rolls forward.",
                          ],
                        ] as const
                      ).map(([value, title, description]) => (
                        <Choice
                          key={value}
                          title={title}
                          selected={draft.iterationMode === value}
                          onClick={() => update({ iterationMode: value })}
                        >
                          {description}
                        </Choice>
                      ))}
                    </fieldset>
                    {draft.iterationMode === "automatic" && (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <Select
                          label="Cycle length"
                          value={draft.iterationWeeks}
                          onChange={(value) =>
                            update({ iterationWeeks: value })
                          }
                          options={Array.from({ length: 8 }, (_, i) => [
                            String(i + 1),
                            `${i + 1} week${i ? "s" : ""}`,
                          ])}
                        />
                        <Select
                          label="Starts on"
                          value={draft.iterationStartDay}
                          onChange={(value) =>
                            update({ iterationStartDay: value })
                          }
                          options={[
                            "Sunday",
                            "Monday",
                            "Tuesday",
                            "Wednesday",
                            "Thursday",
                            "Friday",
                            "Saturday",
                          ].map((name, i) => [String(i), name])}
                        />
                        <p className="col-span-2 text-xs leading-relaxed text-muted-foreground">
                          Saving setup starts the cycle covering today and plans
                          two ahead. An administrator must configure the
                          server’s iteration scheduler for automatic
                          progression.
                        </p>
                      </div>
                    )}
                    <div className="mt-6">
                      <Select
                        label="Estimate scale"
                        value={draft.estimateScale}
                        onChange={(value) =>
                          update({
                            estimateScale: value as Draft["estimateScale"],
                          })
                        }
                        options={Object.entries(estimateLabels)}
                      />
                    </div>
                  </>
                )}
              </>
            )}
            {draft.step === 3 && (
              <>
                <OnboardingHeading title="Review your setup">
                  Create the project with these settings. You can change your
                  team’s configuration later.
                </OnboardingHeading>
                <dl className="border-y text-[13px]">
                  {[
                    ["Organization", organization.name],
                    ["Project", `${draft.name} · ${effectiveKey}`],
                    ["Team", draft.teamName],
                    [
                      "Delivery",
                      draft.deliveryMode === "native"
                        ? "Lictory"
                        : "Jira Cloud · connection deferred",
                    ],
                    [
                      "Readiness",
                      draft.readinessPolicy
                        ? policyLabels[draft.readinessPolicy]
                        : "",
                    ],
                    [
                      "Planning",
                      draft.deliveryMode === "external"
                        ? "Owned by Jira"
                        : draft.iterationMode
                          ? planningLabels[draft.iterationMode] +
                            (draft.iterationMode === "automatic"
                              ? ` · ${draft.iterationWeeks} weeks`
                              : "")
                          : "",
                    ],
                    [
                      "Estimates",
                      draft.deliveryMode === "external"
                        ? "Owned by Jira"
                        : draft.estimateScale
                          ? estimateLabels[draft.estimateScale]
                          : "",
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex justify-between gap-5 border-b py-3 first:pt-0 last:border-0 last:pb-0"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="text-right font-medium break-words">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-6 space-y-4 text-xs leading-relaxed text-muted-foreground">
                  <div>
                    <h2 className="mb-1 font-medium text-foreground">
                      Included
                    </h2>
                    <p>
                      Epic and Story specifications, plus Tasks, Bugs, and
                      Subtasks. Product, Engineering, and QA roles; you start in
                      Product.
                    </p>
                    <p className="mt-1">
                      Delivery workflow: Backlog, Todo, In Progress, In Review,
                      Done, and Canceled. Refinement and approvals stay
                      separate.
                    </p>
                  </div>
                  <div>
                    <h2 className="mb-1 font-medium text-foreground">
                      Set up later
                    </h2>
                    <p>
                      Invite teammates, assign their roles, and customize the
                      workflow in settings. Choose reviewers for each
                      specification.
                    </p>
                    {draft.deliveryMode === "external" && (
                      <p className="mt-1">
                        Connect Jira and map issue types in organization
                        settings before exporting. You can start refining now.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </fieldset>
          {uncertain && (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              Your setup may already have been saved. Retry safely with the same
              choices to confirm.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-8 flex items-center justify-between gap-3 border-t pt-6">
            {draft.step > 0 ? (
              <Button
                variant="ghost"
                size="lg"
                disabled={busy || uncertain}
                onClick={() =>
                  update({
                    step:
                      draft.step === 3 && draft.deliveryMode === "external"
                        ? 1
                        : draft.step - 1,
                  })
                }
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
                  (draft.step === 0
                    ? !identityValid
                    : draft.step === 1
                      ? !deliveryValid
                      : draft.step === 2
                        ? !planningValid
                        : !setupValid))
              }
            >
              {busy
                ? "Saving setup…"
                : uncertain
                  ? "Confirm saved setup"
                  : draft.step === 3
                    ? "Create project"
                    : "Continue"}
              {!busy && <ArrowRight className="size-4" />}
            </Button>
          </div>
        </form>
      </div>
    </OnboardingFrame>
  );
}
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
}) {
  const id = useId();
  return (
    <div className="text-sm">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <div className="mt-2">
        {cloneElement(children, { id, "aria-describedby": `${id}-hint` })}
      </div>
      <p
        id={`${id}-hint`}
        className="mt-2 text-xs leading-relaxed text-muted-foreground"
      >
        {hint}
      </p>
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
        placeholder="Choose an option"
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
