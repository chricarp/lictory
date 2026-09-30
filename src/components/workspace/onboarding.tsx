"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingEntry } from "./onboarding-entry";
import { OnboardingFrame, OnboardingHeading } from "./onboarding-frame";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { slugify, suggestKey } from "~/lib/work-items";
import { formValue } from "~/lib/utils";
import { paths } from "~/lib/paths";
import { useWorkspace } from "./provider";

export function Onboarding({
  step,
  userName,
  canCreate = true,
}: {
  step: "organization" | "project";
  userName?: string;
  canCreate?: boolean;
}) {
  return step === "organization" ? (
    <OnboardingEntry userName={userName} />
  ) : (
    <OnboardingFrame stage={1}>
      <OnboardingHeading title="Add a project">
        Your team’s configuration is already in place. Choose a project name and
        a lasting key for its item identifiers.
      </OnboardingHeading>
      {canCreate ? (
        <CreateProject />
      ) : (
        <p className="text-sm text-muted-foreground">
          Ask an organization administrator to create a project.
        </p>
      )}
    </OnboardingFrame>
  );
}

export function CreateOrganization() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        // Read the DOM value: it is correct even if typing began before hydration.
        const submitted = (
          formValue(new FormData(e.currentTarget), "name") || name
        ).trim();
        if (!submitted) return;
        setPending(true);
        setError(undefined);
        try {
          const result = await authClient.organization.create({
            name: submitted,
            slug: `${slugify(submitted) || "org"}-${crypto.randomUUID().slice(0, 6)}`,
          });
          if (result.error) throw new Error(result.error.message);
          router.push(paths.org(result.data.slug));
          router.refresh();
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not create organization. Try again.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-sm font-medium">
        Organization name
        <Input
          name="name"
          className="mt-1.5"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
          placeholder="Your company or workspace"
          autoFocus
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Creating organization…" : "Create organization"}
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
  const effectiveKey = (touched ? key : suggestKey(name)).toUpperCase();
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const submittedName = (formValue(data, "name") || name).trim();
        const submittedKey = (formValue(data, "key") || effectiveKey)
          .trim()
          .toUpperCase();
        if (!submittedName || !/^[A-Z][A-Z0-9]{1,9}$/.test(submittedKey))
          return;
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
      <label className="block text-sm font-medium">
        Project name
        <Input
          name="name"
          className="mt-1.5"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
          placeholder="Payments"
        />
      </label>
      <label className="block text-sm font-medium">
        Key
        <Input
          name="key"
          className="mt-1.5 font-mono uppercase"
          value={effectiveKey}
          onChange={(e) => {
            setTouched(true);
            setKey(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 10),
            );
          }}
          pattern="[A-Z][A-Z0-9]{1,9}"
          required
          placeholder="PAY"
        />
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          2–10 letters or digits. Items become {effectiveKey || "KEY"}-1,{" "}
          {effectiveKey || "KEY"}-2…
        </span>
      </label>
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
