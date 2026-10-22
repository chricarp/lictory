"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { OnboardingFrame, OnboardingHeading } from "@lictory/platform/components/workspace/onboarding-frame";
import { seedSetupDraft } from "@lictory/platform/components/workspace/onboarding-draft";
import { authClient } from "@lictory/platform/lib/auth-client";
import { Button } from "@lictory/ui/button";
import { StateIllustration } from "@lictory/ui/state-illustration";
import { Input } from "@lictory/ui/input";
import { suggestKey } from "@lictory/core/lib/work-items";
import {
  normalizeOrganizationHandle,
  organizationHandleError,
  suggestOrganizationHandle,
} from "@lictory/core/lib/organization-handles";
import {
  OrganizationHandleField,
  useOrganizationHandle,
} from "@lictory/platform/components/workspace/organization-handle-field";
import { formValue } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

const keyPattern = /^[A-Z][A-Z0-9]{1,9}$/;
const cleanKey = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);

/** Shown when an organization has been set up but has no active project. */
export function Onboarding({ canCreate = true }: { canCreate?: boolean }) {
  return (
    <OnboardingFrame>
      <StateIllustration kind="proposal" />
      <OnboardingHeading title="Add a project">
        {canCreate
          ? "It starts with the default workflow and the Product, Engineering and QA disciplines. Change either in the project’s settings."
          : "Ask an organization administrator to create a project."}
      </OnboardingHeading>
      {canCreate && <CreateProject />}
    </OnboardingFrame>
  );
}

/** Project name with its derived, editable item key. */
export function ProjectFields({
  name,
  projectKey,
  onName,
  onKey,
  autoFocus = true,
}: {
  name: string;
  projectKey: string;
  onName: (name: string) => void;
  onKey: (key: string) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const sample = projectKey || "KEY";
  return (
    <div>
      <div className="grid grid-cols-[1fr_104px] gap-3">
        <label className="block text-sm font-medium">
          Project
          <Input
            name="name"
            className="mt-2"
            value={name}
            onChange={(e) => onName(e.target.value)}
            required
            maxLength={120}
            autoFocus={autoFocus}
            placeholder="Payments"
          />
        </label>
        <label className="block text-sm font-medium">
          Key
          <Input
            name="key"
            className="mt-2 font-mono uppercase"
            value={projectKey}
            onChange={(e) => onKey(cleanKey(e.target.value))}
            pattern="[A-Z][A-Z0-9]{1,9}"
            maxLength={10}
            required
            placeholder="PAY"
            aria-describedby={id}
          />
        </label>
      </div>
      <p id={id} className="mt-2 text-xs text-muted-foreground">
        Items become{" "}
        <span className="font-mono text-foreground">{sample}-1</span>,{" "}
        <span className="font-mono text-foreground">{sample}-2</span>. The key
        is permanent.
      </p>
    </div>
  );
}

export function CreateOrganization({ userId }: { userId?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState<string | null>(null);
  const handleValue = handle ?? suggestOrganizationHandle(name);
  const handleStatus = useOrganizationHandle(handleValue);
  const [project, setProject] = useState("");
  const [key, setKey] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const effectiveKey = touched ? key : suggestKey(project);
  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        // Read the DOM values: they are correct even if typing began before hydration.
        const data = new FormData(e.currentTarget);
        const submitted = (formValue(data, "organization") || name).trim();
        const projectName = (formValue(data, "name") || project).trim();
        const projectKey = cleanKey(formValue(data, "key") || effectiveKey);
        if (!submitted || !projectName || !keyPattern.test(projectKey)) return;
        setPending(true);
        setError(undefined);
        try {
          const result = await authClient.organization.create({
            name: submitted,
            slug: normalizeOrganizationHandle(
              formValue(data, "organizationHandle"),
            ),
          });
          if (result.error)
            throw new Error(organizationHandleError(result.error));
          // The project is created with the delivery setup, in one transaction.
          if (userId)
            seedSetupDraft(userId, result.data.id, {
              name: projectName,
              key: projectKey,
            });
          router.push(paths.org(result.data.slug));
          router.refresh();
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not create organization. Try again.",
          );
          setPending(false);
        }
      }}
    >
      <label className="block text-sm font-medium">
        Organization
        <Input
          name="organization"
          className="mt-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          placeholder="Acme Inc."
          autoComplete="organization"
          autoFocus
        />
      </label>
      <OrganizationHandleField
        value={handleValue}
        onChange={setHandle}
        status={handleStatus}
        disabled={pending}
      />
      <ProjectFields
        name={project}
        projectKey={effectiveKey}
        autoFocus={false}
        onName={setProject}
        onKey={(k) => {
          setTouched(true);
          setKey(k);
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={
          pending ||
          handleStatus.blocked ||
          !name.trim() ||
          !project.trim() ||
          !keyPattern.test(effectiveKey)
        }
      >
        {pending ? "Creating…" : "Continue"}
        {!pending && <ArrowRight className="size-4" />}
      </Button>
    </form>
  );
}

// Projects start with the default workflow, every organization type and the
// Product, Engineering and QA disciplines; the creator becomes its admin.
export function CreateProject({
  onDone,
  withDescription = false,
  destination,
}: {
  onDone?: () => void;
  withDescription?: boolean;
  destination?: (key: string) => string;
}) {
  const router = useRouter();
  const { mutate, engine, organization } = useWorkspace();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const effectiveKey = touched ? key : suggestKey(name);
  return (
    <form
      className="space-y-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const submittedName = (formValue(data, "name") || name).trim();
        const submittedKey = cleanKey(formValue(data, "key") || effectiveKey);
        if (!submittedName || !keyPattern.test(submittedKey)) return;
        setPending(true);
        setError(undefined);
        try {
          const id = await mutate({
            type: "createProject",
            projectId: crypto.randomUUID(),
            name: submittedName,
            key: submittedKey,
            ...(description.trim() && { description: description.trim() }),
          });
          await engine.sync();
          const failed = engine
            .getSnapshot()
            .pending.find((q) => q.mutation.id === id && q.error);
          if (failed) throw new Error(failed.error);
          onDone?.();
          router.push(
            destination?.(submittedKey) ??
              paths.list(organization.slug, submittedKey, "epics"),
          );
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not create project.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <ProjectFields
        name={name}
        projectKey={effectiveKey}
        onName={setName}
        onKey={(k) => {
          setTouched(true);
          setKey(k);
        }}
      />
      {withDescription && (
        <label className="block text-sm font-medium">
          Description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
          <textarea
            name="description"
            className="mt-2 block min-h-20 w-full rounded-xl border border-input bg-card px-3.5 py-2.5 text-[15px] shadow-[0_1px_2px_oklch(0_0_0/0.03)] transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-3 focus:ring-primary/10"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            placeholder="What this product area covers"
          />
        </label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        Create project
      </Button>
    </form>
  );
}
