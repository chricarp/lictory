import { useState } from "react";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  doneCheckLabel,
  type DoneCheckDefinition,
} from "@lictory/core/claims/contracts";
import { relativeTime, type Project } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Checkbox } from "@lictory/ui/checkbox";
import { Input } from "@lictory/ui/input";
import { Switch } from "@lictory/ui/switch";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { Field } from "@lictory/platform/components/settings/project-shared";
import { useDefinitionOfDone } from "@lictory/platform/components/claims/claims";

const codeChecks = [
  {
    kind: "pull_request_merged",
    hint: "Linked when they name the item's key",
  },
  {
    kind: "checks_passed",
    hint: "Required checks on the head commit",
  },
  {
    kind: "code_review_approved",
    hint: "The reviewer agent when set, otherwise any reviewer",
  },
] as const;

type Acceptance = Extract<DoneCheckDefinition, { kind: "acceptance_verified" }>;

// The delivery twin of the Definition of Ready: what must be true before
// work is Done. Done then follows from evidence; nobody, and no agent's
// report, has to set it.
export function ProjectDefinitionOfDone({
  project,
  canEdit,
}: {
  project: Project;
  canEdit: boolean;
}) {
  const { organization, directory, memberName } = useWorkspace();
  const { stored, checks } = useDefinitionOfDone(project.id);
  // Null until edited: an untouched editor shows the stored definition,
  // including one another administrator just saved.
  const [edited, setEdited] = useState<DoneCheckDefinition[] | null>(null);
  const draft = edited ?? checks;
  const setDraft = (
    next: (current: DoneCheckDefinition[]) => DoneCheckDefinition[],
  ) => setEdited(next(draft));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const storedJson = JSON.stringify(checks);
  const external = project.deliveryMode !== "native";
  const editable = canEdit && !external;
  const disciplines = directory.disciplines.filter(
    (d) => d.projectId === project.id && !d.archivedAt,
  );
  const changed = JSON.stringify(draft) !== storedJson;
  const has = (kind: string) => draft.some((c) => c.kind === kind);
  const toggle = (kind: (typeof codeChecks)[number]["kind"], on: boolean) =>
    setDraft((d) =>
      on ? [...d, { id: kind, kind }] : d.filter((c) => c.kind !== kind),
    );
  const acceptance = draft.filter(
    (c): c is Acceptance => c.kind === "acceptance_verified",
  );
  const updateAcceptance = (id: string, patch: Partial<Acceptance>) =>
    setDraft((d) =>
      d.map((c) =>
        c.id === id && c.kind === "acceptance_verified"
          ? { ...c, ...patch }
          : c,
      ),
    );
  const save = async () => {
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await callCapability<{ completed: number }>(
        "setDefinitionOfDone",
        {
          organizationId: organization.id,
          projectId: project.id,
          checks: draft,
          expectedVersion: stored?.version ?? 0,
        },
      );
      setNotice(
        result.completed
          ? `Saved. ${result.completed} item${result.completed === 1 ? " now passes and moved" : "s now pass and moved"} to Done.`
          : "Saved.",
      );
      setEdited(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The definition was not saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsSection
      id="done"
      icon={<ListChecks />}
      title="Definition of Done"
      description="When every check passes, the item moves to Done and records the revision it delivered."
      footer={
        stored
          ? `Version ${stored.version}, set by ${memberName(stored.updatedById)} ${relativeTime(stored.updatedAt)}`
          : "Lictory's defaults: a merged pull request with passing checks."
      }
    >
      <SettingsBody className="space-y-5">
        {external && (
          <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
            The external delivery tool decides when work is done.
          </p>
        )}
        <Field label="From the code host">
          <ul className="space-y-2">
            {codeChecks.map(({ kind, hint }) => (
              <li key={kind} className="flex items-start gap-3">
                <Switch
                  size="sm"
                  aria-label={doneCheckLabel({ id: kind, kind })}
                  disabled={!editable}
                  checked={has(kind)}
                  onCheckedChange={(on) => toggle(kind, on)}
                  className="mt-0.5"
                />
                <div className="text-[13px]">
                  <p className="font-medium">
                    {doneCheckLabel({ id: kind, kind })}
                  </p>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
              </li>
            ))}
          </ul>
        </Field>
        <Field
          label="Confirmed by people"
          hint="Signed off by the chosen disciplines (any, when none is chosen), per accepted revision"
        >
          <ul className="space-y-3">
            {acceptance.map((check) => (
              <li
                key={check.id}
                className="space-y-2 rounded-lg border bg-card p-3"
              >
                <div className="flex items-center gap-2">
                  <Input
                    aria-label="Sign-off name"
                    disabled={!editable}
                    value={check.label}
                    maxLength={120}
                    onChange={(e) =>
                      updateAcceptance(check.id, { label: e.target.value })
                    }
                    className="h-8 flex-1 text-[13px]"
                  />
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove “${check.label}”`}
                      onClick={() =>
                        setDraft((d) => d.filter((c) => c.id !== check.id))
                      }
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {disciplines.map((d) => (
                    <label
                      key={d.id}
                      className="flex items-center gap-1.5 text-[13px]"
                    >
                      <Checkbox
                        disabled={!editable}
                        checked={check.disciplineIds.includes(d.id)}
                        onCheckedChange={(on) =>
                          updateAcceptance(check.id, {
                            disciplineIds: on
                              ? [...check.disciplineIds, d.id]
                              : check.disciplineIds.filter((x) => x !== d.id),
                          })
                        }
                      />
                      {d.name}
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {editable && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setDraft((d) => [
                  ...d,
                  {
                    id: `acceptance-${crypto.randomUUID().slice(0, 8)}`,
                    kind: "acceptance_verified",
                    label: "Acceptance criteria verified",
                    disciplineIds: disciplines
                      .filter((x) => x.name === "QA")
                      .map((x) => x.id),
                  },
                ])
              }
            >
              <Plus className="size-3.5" aria-hidden />
              Add sign-off
            </Button>
          )}
        </Field>
        {draft.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            No checks: people move work to Done by hand.
          </p>
        )}
        {editable && (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!changed || saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save"}
            </Button>
            {changed && (
              <Button variant="ghost" onClick={() => setEdited(null)}>
                Discard changes
              </Button>
            )}
            {notice && (
              <p role="status" className="text-[13px] text-muted-foreground">
                {notice}
              </p>
            )}
          </div>
        )}
        <InlineError>{error}</InlineError>
      </SettingsBody>
    </SettingsSection>
  );
}
