import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "@lictory/platform/lib/navigation";
import { Link } from "@lictory/platform/lib/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { authClient } from "@lictory/platform/lib/auth-client";
import { useSessionState } from "@lictory/platform/lib/session";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { StateIllustration } from "@lictory/ui/state-illustration";
import { CreateOrganization } from "@lictory/platform/components/workspace/onboarding";
import {
  OnboardingFrame,
  OnboardingHeading,
  Choice,
  Steps,
} from "@lictory/platform/components/workspace/onboarding-frame";

type Invite = {
  id: string;
  organizationName: string;
  organizationId: string;
  status: string;
  expiresAt: Date | string;
};
export function OnboardingEntry({
  userId,
  userName,
  email,
  invitations = [],
  createOnly = false,
}: {
  userId?: string;
  userName?: string;
  email?: string;
  invitations?: Invite[];
  createOnly?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // Instance policy may reserve organization creation to instance
  // administrators; then joining is the only way in (the server refuses
  // creation either way).
  const sessionUser = useSessionState().session?.user;
  const canCreate = sessionUser?.canCreateOrganization ?? false;
  const instanceAdmin = sessionUser?.instanceAdmin ?? false;
  const requested = createOnly ? "create" : params.get("intent");
  const intent = canCreate ? requested : createOnly ? "unavailable" : "join";
  const [invites, setInvites] = useState(invitations);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState<string>();
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await authClient.organization.listUserInvitations();
      if (result.error)
        throw new Error(result.error.message ?? "Could not check invitations.");
      setInvites(
        (result.data ?? []).filter(
          (i) =>
            i.status === "pending" &&
            new Date(i.expiresAt).getTime() > Date.now(),
        ),
      );
      setError(undefined);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not check invitations. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (intent !== "join") return;
    const check = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = setInterval(check, 30000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [intent, refresh]);
  const pending = invites.filter((i) => i.status === "pending");
  const choose = (value: string) => router.replace(`/?intent=${value}`);
  return (
    <OnboardingFrame>
      <Steps step={intent ?? "discover"} direction={intent ? 1 : -1}>
        <OnboardingHeading
          title={
            intent === "unavailable"
              ? "Organizations are created by your administrator"
              : intent === "join"
                ? canCreate
                  ? "Join your organization"
                  : userName
                    ? `Welcome, ${userName.split(" ")[0]}.`
                    : "Join your organization"
                : intent === "create"
                  ? "Create your workspace"
                  : userName
                    ? `Welcome, ${userName.split(" ")[0]}.`
                    : "Welcome to Lictory"
          }
        >
          {intent === "unavailable"
            ? "Ask your Lictory administrator to create the organization, or to add you to an existing one."
            : intent === "join"
              ? canCreate
                ? undefined
                : "You’re not a member of an organization yet. Your organization’s administrators add you with an invitation."
              : intent === "create"
                ? "Name your company and the first thing you’ll spec."
                : "Turn rough product ideas into specs your team has agreed to build."}
        </OnboardingHeading>
        {!intent && (
          <div className="space-y-3">
            <Choice
              title="Join my organization"
              icon={<Mail />}
              onClick={() => choose("join")}
            >
              {pending.length > 0 ? (
                <span className="font-medium text-primary">
                  {pending.length} invitation{pending.length === 1 ? "" : "s"}{" "}
                  waiting
                </span>
              ) : (
                "Your company already uses Lictory."
              )}
            </Choice>
            <Choice
              title="Create a workspace"
              icon={<Building2 />}
              onClick={() => choose("create")}
            >
              Set up Lictory for your company.
            </Choice>
          </div>
        )}
        {intent === "create" && <CreateOrganization userId={userId} />}
        {instanceAdmin && !intent && (
          <div className="mt-3">
            <Choice
              title="Open the admin console"
              icon={<ShieldCheck />}
              onClick={() => router.push(paths.admin())}
            >
              Manage accounts and organizations for this installation.
            </Choice>
          </div>
        )}
        {intent === "join" && (
          <div className="space-y-4">
            {pending.length ? (
              pending.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
                >
                  <p className="font-medium">{invite.organizationName}</p>
                  <Button
                    size="lg"
                    disabled={Boolean(accepting)}
                    onClick={async () => {
                      setAccepting(invite.id);
                      setError(undefined);
                      try {
                        const result =
                          await authClient.organization.acceptInvitation({
                            invitationId: invite.id,
                          });
                        if (result.error) throw new Error(result.error.message);
                        const joined =
                          await authClient.organization.getFullOrganization({
                            query: { organizationId: invite.organizationId },
                          });
                        router.push(
                          joined.data ? paths.org(joined.data.slug) : "/",
                        );
                      } catch (e) {
                        setError(
                          e instanceof Error
                            ? e.message
                            : "Could not accept invitation.",
                        );
                      } finally {
                        setAccepting(undefined);
                      }
                    }}
                  >
                    {accepting === invite.id ? "Joining…" : "Join"}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed p-6">
                <StateIllustration kind="inbox" />
                <h2 className="text-sm font-medium">No invitation yet</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Ask an admin to invite{" "}
                  <span className="font-medium break-all text-foreground">
                    {email}
                  </span>
                  . This page updates on its own.
                </p>
              </div>
            )}
            <Button
              variant="secondary"
              size="lg"
              disabled={busy}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-4" />
              {busy ? "Checking…" : "Check invitations"}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
        {intent && !createOnly && canCreate && (
          <Button
            variant="ghost"
            className="mt-6 -ml-3"
            onClick={() => router.replace("/")}
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
        )}
        {createOnly && (
          <Link href="/" className="mt-7 block text-sm text-muted-foreground">
            Back to workspace
          </Link>
        )}
      </Steps>
    </OnboardingFrame>
  );
}
