import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { Badge } from "@lictory/ui/primitives";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  InlineError,
  ReadOnlyNotice,
  SettingsBody,
  SettingsList,
  SettingsSection,
  SettingsSubheading,
} from "@lictory/platform/components/workspace/settings-section";

type Security = {
  requireTwoFactor: boolean;
  actorTwoFactorEnabled: boolean;
  members: {
    userId: string;
    name: string;
    email: string;
    role: "admin" | "member";
    twoFactorEnabled: boolean;
  }[];
};

// Organization settings → Security: whether members need two-factor
// authentication before they can open the organization, and recovery for a
// member who lost their authenticator. The server enforces both.
export function OrganizationSecurity() {
  const { organization, isAdmin, userId } = useWorkspace();
  const [security, setSecurity] = useState<Security>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pending, setPending] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSecurity(
        await callCapability<Security>("getOrganizationSecurity", {
          organizationId: organization.id,
        }),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Security settings failed to load.",
      );
    }
  }, [organization.id]);

  useEffect(() => {
    if (!isAdmin) return;
    callCapability<Security>("getOrganizationSecurity", {
      organizationId: organization.id,
    }).then(setSecurity, (e: Error) => setError(e.message));
  }, [isAdmin, organization.id]);

  if (!isAdmin)
    return (
      <ReadOnlyNotice>
        Only organization administrators can see and change security settings.
      </ReadOnlyNotice>
    );

  const required = security?.requireTwoFactor ?? false;
  const without = security?.members.filter((m) => !m.twoFactorEnabled) ?? [];
  const canRequire = security?.actorTwoFactorEnabled ?? false;

  async function setRequired(next: boolean) {
    setPending("policy");
    setError(undefined);
    setNotice(undefined);
    try {
      await callCapability("setTwoFactorRequirement", {
        organizationId: organization.id,
        required: next,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not saved.");
    } finally {
      setPending(null);
    }
  }

  async function reset(member: Security["members"][number]) {
    setPending(member.userId);
    setError(undefined);
    setNotice(undefined);
    try {
      await callCapability("resetMemberTwoFactor", {
        organizationId: organization.id,
        userId: member.userId,
      });
      setNotice(
        `${member.name}'s two-factor authentication was reset. They sign in with their password and set it up again.`,
      );
      setConfirmReset(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Not reset.");
    } finally {
      setPending(null);
    }
  }

  return (
    <SettingsSection
      id="two-factor"
      icon={<ShieldCheck />}
      title="Require two-factor authentication"
      description="Members without two-factor authentication are asked to turn it on before they can open this organization. It applies to password sign-ins; Google and Microsoft sign-ins use the provider's own checks."
      action={
        <button
          type="button"
          role="switch"
          aria-checked={required}
          aria-label="Require two-factor authentication"
          disabled={!security || pending !== null || (!required && !canRequire)}
          onClick={() => setRequired(!required)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-40",
            required ? "bg-primary" : "bg-muted-foreground/25",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-4 rounded-full bg-white shadow-sm transition-transform duration-150 ease-out",
              required ? "translate-x-4.5" : "translate-x-0.5",
            )}
          />
        </button>
      }
      footer="Changes to this requirement and two-factor resets are recorded in the organization's configuration history."
    >
      <SettingsBody className="space-y-2 text-[13px]">
        <p>
          {!security
            ? "Loading…"
            : required
              ? `Required. ${without.length === 0 ? "Every member has two-factor authentication." : `${without.length} ${without.length === 1 ? "member has" : "members have"} not turned it on yet and cannot open the organization until they do.`}`
              : "Not required."}
        </p>
        {security && !required && !canRequire && (
          <p className="text-muted-foreground">
            Turn on two-factor authentication for your own account in{" "}
            <Link
              href={`/account?returnTo=${encodeURIComponent(location.pathname)}#two-factor`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Account settings
            </Link>{" "}
            before requiring it, so you are not locked out.
          </p>
        )}
        <InlineError>{error}</InlineError>
        {notice && (
          <p
            role="status"
            className="text-xs text-emerald-700 dark:text-emerald-400"
          >
            {notice}
          </p>
        )}
      </SettingsBody>
      <div className="border-t border-border">
        <SettingsSubheading>Members</SettingsSubheading>
        <SettingsList
          isEmpty={!security || security.members.length === 0}
          empty={security ? "No members." : "Loading…"}
        >
          {security?.members.map((member) => (
            <div
              key={member.userId}
              className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{member.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {member.email}
                </div>
              </div>
              {member.twoFactorEnabled ? (
                <Badge tone="good">Two-factor on</Badge>
              ) : (
                <Badge tone={required ? "warning" : "neutral"}>
                  Two-factor off
                </Badge>
              )}
              {member.twoFactorEnabled &&
                member.userId !== userId &&
                (confirmReset === member.userId ? (
                  <span className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={pending !== null}
                      onClick={() => reset(member)}
                    >
                      {pending === member.userId
                        ? "Resetting…"
                        : "Confirm reset"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmReset(null)}
                    >
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending !== null}
                    aria-label={`Reset two-factor authentication for ${member.name}`}
                    onClick={() => setConfirmReset(member.userId)}
                  >
                    Reset two-factor
                  </Button>
                ))}
            </div>
          ))}
        </SettingsList>
        <p className="border-t border-border px-5 py-3 text-xs leading-5 text-muted-foreground">
          Reset two-factor only after confirming the person&apos;s identity
          outside Lictory, for example by a call. It removes their authenticator
          app and backup codes; their password and passkeys stay.
        </p>
      </div>
    </SettingsSection>
  );
}
