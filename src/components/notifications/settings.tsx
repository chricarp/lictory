"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, CircleAlert, RotateCcw } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Popover, Picker } from "~/components/ui/popover";
import { useWorkspace } from "~/components/workspace/provider";
import { cn } from "~/lib/utils";
import { paths } from "~/lib/paths";
import {
  categoryLabels,
  notificationCategories,
  notificationKindList,
  notificationKinds,
  resolveChannels,
  type NotificationKind,
  type PreferenceRule,
  type PreferenceScope,
} from "~/notifications/catalog";
import { notificationRequest, type PreferencesResponse } from "./client";

type Scope = { scope: PreferenceScope; scopeId: string };
type Rule =
  | { kind: NotificationKind; inApp: boolean; email: boolean }
  | {
      kind: NotificationKind;
      reset: true;
    };

// Preferences are layered so a person can say "email me about reviews
// everywhere, but mute the Mobile team" without configuring every project.
export function NotificationSettings() {
  const { organization, projects, delivery } = useWorkspace();
  const [rules, setRules] = useState<PreferenceRule[] | null>(null);
  const [scope, setScope] = useState<Scope>({
    scope: "organization",
    scopeId: organization.id,
  });
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const load = useCallback(
    () =>
      notificationRequest<PreferencesResponse>({
        action: "preferences",
        organizationId: organization.id,
      }).then(
        (r) => setRules(r.rules),
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [organization.id],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const teams = [...delivery.teams.values()].filter((t) => !t.archivedAt);
  const scopeOptions = [
    {
      value: `organization:${organization.id}`,
      label: organization.name,
      hint: "Everywhere",
    },
    ...projects.map((p) => ({
      value: `project:${p.id}`,
      label: p.name,
      hint: `Project ${p.key}`,
    })),
    ...teams.map((t) => ({
      value: `team:${t.id}`,
      label: t.name,
      hint: "Team",
    })),
  ];
  const scopeLabel =
    scopeOptions.find((o) => o.value === `${scope.scope}:${scope.scopeId}`)
      ?.label ?? organization.name;
  const context =
    scope.scope === "organization"
      ? { organizationId: organization.id }
      : scope.scope === "project"
        ? { organizationId: organization.id, projectId: scope.scopeId }
        : { organizationId: organization.id, teamId: scope.scopeId };
  const own = (kind: NotificationKind) =>
    rules?.find(
      (r) =>
        r.kind === kind &&
        r.scope === scope.scope &&
        r.scopeId === scope.scopeId,
    );
  // What applies here when nothing is set at this scope.
  const inherited = (kind: NotificationKind) => {
    const org = rules?.find(
      (r) =>
        r.kind === kind &&
        r.scope === "organization" &&
        r.scopeId === organization.id,
    );
    return scope.scope !== "organization" && org
      ? { source: "organization" as const, ...org }
      : { source: "default" as const, ...notificationKinds[kind] };
  };

  const save = async (next: Rule[]) => {
    if (!rules) return;
    setSaving(true);
    setError(undefined);
    // Optimistic: apply locally, then take the server's answer.
    setRules([
      ...rules.filter(
        (r) =>
          !(
            r.scope === scope.scope &&
            r.scopeId === scope.scopeId &&
            next.some((n) => n.kind === r.kind)
          ),
      ),
      ...next.flatMap((n) =>
        "reset" in n ? [] : [{ ...scope, ...n, email: n.inApp && n.email }],
      ),
    ]);
    try {
      const r = await notificationRequest<PreferencesResponse>({
        action: "setPreferences",
        organizationId: organization.id,
        ...scope,
        rules: next,
      });
      setRules(r.rules);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      void load();
    } finally {
      setSaving(false);
    }
  };
  const resetScope = async () => {
    setSaving(true);
    try {
      await notificationRequest({
        action: "resetScope",
        organizationId: organization.id,
        ...scope,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const setAll = (
    patch: (c: { inApp: boolean; email: boolean }) => {
      inApp: boolean;
      email: boolean;
    },
  ) =>
    void save(
      notificationKindList.map((kind) => ({
        kind,
        ...patch(resolveChannels(rules ?? [], kind, context)),
      })),
    );
  const hasOwn = rules?.some(
    (r) => r.scope === scope.scope && r.scopeId === scope.scopeId,
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <Link
          href={paths.inbox(organization.slug)}
          aria-label="Back to inbox"
          className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <h1 className="text-sm font-semibold">Notification settings</h1>
        {saving && (
          <span className="text-xs text-muted-foreground">Saving…</span>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] text-muted-foreground">
                Settings for
              </span>
              <Popover
                width={260}
                trigger={(props) => (
                  <button
                    {...props}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-card px-2.5 text-[13px] font-medium hover:bg-muted"
                  >
                    {scopeLabel}
                    <ChevronDown className="size-3.5 text-muted-foreground" />
                  </button>
                )}
              >
                <Picker
                  title="Apply to"
                  options={scopeOptions}
                  value={`${scope.scope}:${scope.scopeId}`}
                  onSelect={(v) => {
                    const [s, id] = v.split(":") as [PreferenceScope, string];
                    setScope({ scope: s, scopeId: id });
                  }}
                />
              </Popover>
              <div className="ml-auto flex flex-wrap items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!rules}
                  onClick={() => setAll((c) => ({ ...c, email: false }))}
                >
                  No email
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!rules}
                  onClick={() => setAll(() => ({ inApp: false, email: false }))}
                >
                  Turn all off
                </Button>
                {hasOwn && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void resetScope()}
                  >
                    <RotateCcw className="size-3.5" />
                    {scope.scope === "organization"
                      ? "Reset to defaults"
                      : "Use organization settings"}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-[13px] leading-5 text-muted-foreground">
              {scope.scope === "organization"
                ? `Applies to everything in ${organization.name} unless a project or team says otherwise.`
                : scope.scope === "project"
                  ? `Overrides your ${organization.name} settings for items in this project. Team settings still win for items of that team.`
                  : `Overrides your project and ${organization.name} settings for items and iterations of this team.`}{" "}
              Turn a notification on to receive it in your Inbox; you can then
              also choose to get it by email.
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="flex items-center gap-2 rounded-md bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400"
            >
              <CircleAlert className="size-3.5" /> {error}
            </p>
          )}
          {!rules ? (
            <p className="text-[13px] text-muted-foreground">Loading…</p>
          ) : (
            notificationCategories.map((category) => (
              <section
                key={category}
                aria-labelledby={`category-${category}`}
                className="rounded-xl bg-card shadow-[var(--shadow-border)]"
              >
                <div className="flex items-center gap-3 border-b px-4 py-2.5">
                  <h2
                    id={`category-${category}`}
                    className="flex-1 text-[13px] font-semibold"
                  >
                    {categoryLabels[category]}
                  </h2>
                </div>
                <ul className="divide-y">
                  {notificationKindList
                    .filter((k) => notificationKinds[k].category === category)
                    .map((kind) => {
                      const def = notificationKinds[kind];
                      const mine = own(kind);
                      const effective = mine ?? inherited(kind);
                      const origin = mine
                        ? null
                        : inherited(kind).source === "organization"
                          ? "From organization settings"
                          : "Default";
                      const set = (inApp: boolean, email: boolean) =>
                        void save([{ kind, inApp, email }]);
                      return (
                        <li
                          key={kind}
                          className="flex items-center gap-3 px-4 py-2.5"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-[13px] font-medium">
                              {def.label}
                              {origin ? (
                                <span className="text-[11px] font-normal text-muted-foreground">
                                  {origin}
                                </span>
                              ) : (
                                <button
                                  onClick={() =>
                                    void save([{ kind, reset: true }])
                                  }
                                  className="text-[11px] font-normal text-primary hover:underline"
                                >
                                  Reset
                                </button>
                              )}
                            </p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              {def.description}
                            </p>
                            {effective.inApp && (
                              <label className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                <input
                                  type="checkbox"
                                  className="size-3.5 accent-primary"
                                  checked={effective.email}
                                  onChange={(e) => set(true, e.target.checked)}
                                />
                                Also send an email
                              </label>
                            )}
                          </div>
                          <Toggle
                            label={def.label}
                            checked={effective.inApp}
                            onChange={(v) => set(v, v && effective.email)}
                          />
                        </li>
                      );
                    })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <span className="flex shrink-0 justify-center">
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
          checked ? "bg-primary" : "bg-muted-foreground/25",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </button>
    </span>
  );
}
