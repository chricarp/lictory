"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { OnboardingFrame, OnboardingHeading } from "./onboarding-frame";
import { seedSetupDraft } from "./onboarding-draft";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { slugify, suggestKey } from "~/lib/work-items";
import { formValue } from "~/lib/utils";
import { paths } from "~/lib/paths";
import { useWorkspace } from "./provider";

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
      <OnboardingHeading title="Add a project">
        {canCreate
          ? "Your team settings are already in place."
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
            slug: `${slugify(submitted) || "org"}-${crypto.randomUUID().slice(0, 6)}`,
          });
          if (result.error) throw new Error(result.error.message);
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

export function CreateProject({ onDone }: { onDone?: () => void }) {
  const router = useRouter();
  const { mutate, engine, organization } = useWorkspace();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
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
          });
          await engine.sync();
          const failed = engine
            .getSnapshot()
            .pending.find((q) => q.mutation.id === id && q.error);
          if (failed) throw new Error(failed.error);
          onDone?.();
          router.push(paths.list(organization.slug, submittedKey, "epics"));
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
