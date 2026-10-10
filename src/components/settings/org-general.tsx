"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { cn } from "~/lib/utils";
import { authClient } from "~/lib/auth-client";
import { ACCEPT_LOGO, MAX_LOGO_SIZE, type LogoKind } from "~/branding/logo";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useWorkspace } from "~/components/workspace/provider";
import {
  InlineError,
  SettingsBody,
  SettingsSection,
} from "~/components/workspace/settings-section";

export function OrganizationGeneral() {
  const { organization, isAdmin } = useWorkspace();
  const router = useRouter();
  return (
    <SettingsSection
      id="general"
      icon={<Building2 />}
      title="General"
      description="The organization's name and logos, as shown to every member."
    >
      <SettingsBody>
        {isAdmin ? (
          <RenameOrganization
            name={organization.name}
            onRename={async (name) => {
              const result = await authClient.organization.update({
                organizationId: organization.id,
                data: { name },
              });
              if (result.error) throw new Error(result.error.message);
              router.refresh();
            }}
          />
        ) : (
          <dl className="grid gap-1 text-[13px]">
            <dt className="text-xs text-muted-foreground">Organization name</dt>
            <dd className="font-medium">{organization.name}</dd>
          </dl>
        )}
        <Branding />
      </SettingsBody>
    </SettingsSection>
  );
}

const logoFields: {
  kind: LogoKind;
  label: string;
  hint: string;
  preview: string;
}[] = [
  {
    kind: "mark",
    label: "Logomark",
    hint: "Square symbol, at least 64×64. Shown when the sidebar is collapsed and in the organization list.",
    preview: "size-12",
  },
  {
    kind: "full",
    label: "Full logo",
    hint: "Wide logo including the name, about 6:1. Replaces the name in the sidebar.",
    preview: "h-12 w-48",
  },
];

// Branding is optional; without a logomark the organization's initial is
// used, and without a full logo the name is shown as text.
function Branding() {
  const { organization, isAdmin, engine } = useWorkspace();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState<LogoKind | null>(null);
  const change = async (kind: LogoKind, file: File | null) => {
    setError("");
    setPending(kind);
    try {
      const response = await fetch(
        `/api/organizations/${encodeURIComponent(organization.id)}/logo/${kind}`,
        file
          ? {
              method: "PUT",
              body: file,
              headers: {
                "Content-Type": file.type || "application/octet-stream",
              },
            }
          : { method: "DELETE" },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "The logo was not saved.");
      }
      await engine.sync();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The logo was not saved.");
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="mt-5 space-y-4 border-t border-border pt-5">
      {logoFields.map((field) => {
        const src = organization.logos[field.kind];
        const inputId = `organization-logo-${field.kind}`;
        return (
          <div key={field.kind} className="flex items-center gap-4">
            <div
              className={cn(
                "grid shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/40 p-1.5",
                field.preview,
              )}
            >
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, authenticated image
                <img
                  src={src}
                  alt={`${organization.name} ${field.label.toLowerCase()}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-[11px] text-muted-foreground">None</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">{field.label}</p>
              <p className="text-xs text-muted-foreground">{field.hint}</p>
            </div>
            {isAdmin && (
              <div className="flex shrink-0 gap-1.5">
                <input
                  id={inputId}
                  type="file"
                  accept={ACCEPT_LOGO}
                  className="sr-only"
                  aria-label={`Upload ${field.label.toLowerCase()}`}
                  disabled={pending !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (file) void change(field.kind, file);
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending !== null}
                  onClick={() => document.getElementById(inputId)?.click()}
                >
                  {pending === field.kind
                    ? "Saving…"
                    : src
                      ? "Replace"
                      : "Upload"}
                </Button>
                {src && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending !== null}
                    aria-label={`Remove ${field.label.toLowerCase()}`}
                    onClick={() => void change(field.kind, null)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        PNG, JPEG or WebP up to {MAX_LOGO_SIZE / 1024} KB. Transparent
        backgrounds work best in both light and dark themes.
      </p>
      <InlineError>{error}</InlineError>
    </div>
  );
}

function RenameOrganization({
  name,
  onRename,
}: {
  name: string;
  onRename: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(undefined);
        setPending(true);
        try {
          await onRename(value.trim());
        } catch (err) {
          setError(err instanceof Error ? err.message : "Could not rename.");
        } finally {
          setPending(false);
        }
      }}
    >
      <label className="block text-[13px] font-medium">
        Organization name
        <div className="mt-1.5 flex gap-2">
          <Input
            className="h-8 max-w-sm rounded-md text-sm"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={pending || !value.trim() || value.trim() === name}
          >
            {pending ? "Saving…" : "Rename"}
          </Button>
        </div>
      </label>
      <InlineError>{error}</InlineError>
    </form>
  );
}
