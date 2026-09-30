"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, RefreshCw, Users, Building2 } from "lucide-react";
import { authClient } from "~/lib/auth-client";
import { Button } from "~/components/ui/button";
import { CreateOrganization } from "./onboarding";
import { OnboardingFrame, OnboardingHeading, Choice } from "./onboarding-frame";

type Invite = {
  id: string;
  organizationName: string;
  organizationId: string;
  status: string;
  expiresAt: Date | string;
};
export function OnboardingEntry({
  userName,
  email,
  invitations = [],
  createOnly = false,
}: {
  userName?: string;
  email?: string;
  invitations?: Invite[];
  createOnly?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const intent = createOnly ? "create" : params.get("intent");
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
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not check invitations. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }, [router]);
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
  const choose = (value: string) => router.replace(`/app?intent=${value}`);
  return (
    <OnboardingFrame stage={intent ? 1 : 0}>
      <div key={intent ?? "discover"} className="onboarding-step">
        <OnboardingHeading
          title={
            intent === "join"
              ? "Your team is worth waiting for."
              : intent === "create"
                ? "Give your team a home."
                : userName
                  ? `Welcome, ${userName.split(" ")[0]}.`
                  : "Welcome to Lictory."
          }
        >
          {intent === "join"
            ? "Join an existing organization to use its projects, reviews, and delivery setup. You won’t need to configure them again."
            : intent === "create"
              ? "An organization is your company’s shared workspace. You’ll be its administrator. Next, we’ll help you choose how your first team works."
              : "Draft a proposal, refine it with your teammates, review each revision, and turn agreed specifications into delivery work. Start by choosing where you belong."}
        </OnboardingHeading>
        {!intent && (
          <div className="space-y-3">
            <Choice title="Join my team" onClick={() => choose("join")}>
              <Users className="mr-2 inline size-4" />
              My company already uses Lictory, or I’m expecting an invitation.
              {pending.length > 0 && (
                <span className="mt-2 block font-medium text-primary">
                  {pending.length} invitation{pending.length === 1 ? "" : "s"}{" "}
                  waiting for you
                </span>
              )}
            </Choice>
            <Choice title="Create a workspace" onClick={() => choose("create")}>
              <Building2 className="mr-2 inline size-4" />
              I’m setting up Lictory for a new organization.
            </Choice>
            <p className="pt-3 text-xs leading-relaxed text-muted-foreground">
              The same refinement workflow supports both delivery in Lictory and
              handoff to Jira Cloud. You’ll choose what fits your team.
            </p>
          </div>
        )}
        {intent === "create" && (
          <>
            <CreateOrganization />
            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              Only your organization’s members can access its workspace. Names
              can change later. Creating an organization does not invite anyone
              or publish work.
            </p>
          </>
        )}
        {intent === "join" && (
          <div className="space-y-4">
            <div className="rounded-xl border bg-card p-5">
              <p className="text-xs text-muted-foreground">
                Checking invitations for
              </p>
              <p className="mt-1 text-sm font-medium break-all">{email}</p>
            </div>
            {pending.length ? (
              pending.map((invite) => (
                <div
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-5"
                >
                  <div>
                    <p className="font-medium">{invite.organizationName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Your organization’s settings are already in place.
                    </p>
                  </div>
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
                          joined.data ? `/app/${joined.data.slug}` : "/app",
                        );
                        router.refresh();
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
                    {accepting === invite.id
                      ? "Joining…"
                      : `Join ${invite.organizationName}`}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed p-6">
                <h2 className="text-sm font-medium">No invitation yet</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Ask your organization’s administrator to invite the email
                  address above and share the invitation link. Keep this page
                  open; we check every 30 seconds while it’s visible.
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Using a different email? You can sign out from your account
                  and sign in with the invited address.
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
        {intent && !createOnly && (
          <Button
            variant="ghost"
            className="mt-7"
            onClick={() => router.replace("/app")}
          >
            Back to my options
          </Button>
        )}
        {createOnly && (
          <Link
            href="/app"
            className="mt-7 block text-sm text-muted-foreground"
          >
            Back to workspace
          </Link>
        )}
      </div>
    </OnboardingFrame>
  );
}
