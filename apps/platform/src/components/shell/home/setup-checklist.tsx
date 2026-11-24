import { useId, useMemo } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useFactory } from "@lictory/platform/components/factory/store";
import { useCodeHosts } from "@lictory/platform/components/code/store";
import { useChannels } from "@lictory/platform/components/channels/store";
import { setupSteps } from "@lictory/platform/components/shell/home/setup";

// Where the factory stands on its first run, from the organization's own
// data. `ready` is false until every source has loaded, so a set-up
// organization never sees the checklist flash.
export function useSetup() {
  const { organization, directory, isAdmin } = useWorkspace();
  const factory = useFactory();
  const code = useCodeHosts();
  const channels = useChannels();
  const ready = factory.complete && code.complete && channels.loaded;
  const result = useMemo(
    () =>
      setupSteps(
        {
          codeConnections: code.connections,
          runners: factory.runners,
          agents: factory.agents,
          channels: channels.list,
          members: directory.members.length,
        },
        organization.slug,
        isAdmin,
      ),
    [
      code.connections,
      factory.runners,
      factory.agents,
      channels.list,
      directory.members.length,
      organization.slug,
      isAdmin,
    ],
  );
  return { ...result, ready };
}

// "Set up Northwind": the steps that make the factory work, each done when
// its data exists. The next step is the one primary action.
export function SetupChecklist({
  setup,
}: {
  setup: ReturnType<typeof setupSteps>;
}) {
  const { organization } = useWorkspace();
  const id = useId();
  const next = setup.steps.find((s) => !s.done && s.action);
  return (
    <section
      aria-labelledby={id}
      data-setup-checklist
      className="rounded-xl bg-card shadow-(--shadow-border)"
    >
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-[13px] font-semibold">
            Set up {organization.name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {setup.done} of {setup.steps.length} done. This list leaves Home
            once everything is in place.
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={setup.steps.length}
          aria-valuenow={setup.done}
          className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted max-sm:hidden"
        >
          <div
            className="h-full rounded-full bg-success"
            style={{ width: `${(setup.done / setup.steps.length) * 100}%` }}
          />
        </div>
      </div>
      <ol className="divide-y divide-border/70">
        {setup.steps.map((step) => (
          <li
            key={step.id}
            data-setup-step={step.id}
            data-done={step.done || undefined}
            className="flex items-center gap-3 px-4 py-2.5"
          >
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full",
                step.done
                  ? "bg-success text-white dark:text-background"
                  : "ring-1 ring-foreground/20 ring-inset",
              )}
            >
              {step.done && (
                <Check aria-hidden className="size-3" strokeWidth={3} />
              )}
              <span className="sr-only">{step.done ? "Done:" : "To do:"}</span>
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-[13px] leading-5",
                  step.done
                    ? "text-muted-foreground line-through decoration-foreground/30"
                    : "font-medium",
                )}
              >
                {step.title}
              </span>
              {!step.done && (
                <span className="block text-xs leading-4 text-muted-foreground">
                  {step.action
                    ? step.detail
                    : `${step.detail} An administrator sets this up.`}
                </span>
              )}
            </span>
            {!step.done && step.action && (
              <Button
                size="sm"
                variant={step === next ? "primary" : "ghost"}
                render={<Link href={step.action.href} />}
              >
                {step.action.label}
                {step === next && (
                  <ArrowRight aria-hidden className="size-3.5" />
                )}
              </Button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
