"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Layers3 } from "lucide-react";
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
  step: "organization" | "product";
  userName?: string;
  canCreate?: boolean;
}) {
  return (
    <main className="mx-auto max-w-md px-6 py-20">
      <Layers3 className="mb-5 size-7 text-primary" />
      {step === "organization" ? (
        <>
          <h1 className="text-xl font-semibold tracking-tight">
            {userName ? `Welcome, ${userName.split(" ")[0]}.` : "Welcome."}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Create an organization for your team. You can invite people and add
            products afterwards.
          </p>
          <CreateOrganization />
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold tracking-tight">
            Add your first product
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A product groups Epics and Stories. Its key prefixes every item
            identifier, like <span className="font-mono">PAY-142</span>.
          </p>
          {canCreate ? (
            <CreateProduct />
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">
              An organization administrator needs to create the first product.
            </p>
          )}
        </>
      )}
    </main>
  );
}

function CreateOrganization() {
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
        const result = await authClient.organization.create({
          name: submitted,
          slug: `${slugify(submitted) || "org"}-${crypto.randomUUID().slice(0, 6)}`,
        });
        setPending(false);
        if (result.error) return setError(result.error.message);
        router.push(paths.org(result.data.slug));
        router.refresh();
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
          autoFocus
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        Create organization
      </Button>
    </form>
  );
}

export function CreateProduct({ onDone }: { onDone?: () => void }) {
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
            type: "createProduct",
            productId: crypto.randomUUID(),
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
            err instanceof Error ? err.message : "Could not create product.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-sm font-medium">
        Product name
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
        Create product
      </Button>
    </form>
  );
}
