"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  KeyRound,
  Link2,
  Mail,
  MonitorSmartphone,
  UserRound,
} from "lucide-react";

import { FormField, FormMessage } from "~/components/auth/form-field";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { formValue } from "~/lib/utils";

type AccountSettingsProps = {
  user: { name: string; email: string; emailVerified: boolean };
  providers: { google: boolean; microsoft: boolean };
  connectedProviders: string[];
  sessionCount: number;
};

export function AccountSettings(props: AccountSettingsProps) {
  const hasPassword = props.connectedProviders.includes("credential");

  return (
    <div className="grid gap-6">
      <ProfileSection user={props.user} />
      <EmailSection user={props.user} />
      {hasPassword ? <PasswordSection /> : null}
      <ConnectionsSection
        providers={props.providers}
        connectedProviders={props.connectedProviders}
      />
      <SessionsSection sessionCount={props.sessionCount} />
      <DeleteSection hasPassword={hasPassword} />
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card shadow-[var(--shadow-border)]">
      <div className="flex gap-4 border-b border-border px-5 py-5 sm:px-6">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-foreground">
          {icon}
        </div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function ProfileSection({ user }: Pick<AccountSettingsProps, "user">) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const name = formValue(new FormData(event.currentTarget), "name");
    const result = await authClient.updateUser({ name });
    setMessage(
      result.error
        ? (result.error.message ?? "Update failed.")
        : "Profile updated.",
    );
    setPending(false);
    if (!result.error) router.refresh();
  }

  return (
    <Section
      icon={<UserRound className="size-5" />}
      title="Profile"
      description="How your name appears to collaborators."
    >
      <form onSubmit={submit} className="grid max-w-lg gap-4">
        <FormField
          id="name"
          name="name"
          label="Full name"
          defaultValue={user.name}
          autoComplete="name"
          required
        />
        <FormMessage
          tone={message === "Profile updated." ? "success" : "error"}
        >
          {message}
        </FormMessage>
        <Button size="lg" type="submit" className="w-fit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </form>
    </Section>
  );
}

function EmailSection({ user }: Pick<AccountSettingsProps, "user">) {
  const pathname = usePathname();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const newEmail = formValue(new FormData(event.currentTarget), "email");
    const result = await authClient.changeEmail({
      newEmail,
      callbackURL: pathname,
    });
    setMessage(
      result.error
        ? (result.error.message ?? "Email change failed.")
        : "Check the new address to confirm this change.",
    );
    setPending(false);
  }

  return (
    <Section
      icon={<Mail className="size-5" />}
      title="Email address"
      description={
        user.emailVerified
          ? "Your current email is verified."
          : "Your current email still needs verification."
      }
    >
      <form onSubmit={submit} className="grid max-w-lg gap-4">
        <FormField
          id="account-email"
          name="email"
          label="Email"
          defaultValue={user.email}
          type="email"
          autoComplete="email"
          required
        />
        <FormMessage tone={message?.startsWith("Check") ? "success" : "error"}>
          {message}
        </FormMessage>
        <Button
          size="lg"
          type="submit"
          variant="secondary"
          className="w-fit"
          disabled={pending}
        >
          {pending ? "Sending…" : "Change email"}
        </Button>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = event.currentTarget;
    const data = new FormData(form);
    const result = await authClient.changePassword({
      currentPassword: formValue(data, "currentPassword"),
      newPassword: formValue(data, "newPassword"),
      revokeOtherSessions: true,
    });
    setMessage(
      result.error
        ? (result.error.message ?? "Password change failed.")
        : "Password changed and other sessions signed out.",
    );
    setPending(false);
    if (!result.error) form.reset();
  }

  return (
    <Section
      icon={<KeyRound className="size-5" />}
      title="Password"
      description="Changing it signs out your other sessions."
    >
      <form onSubmit={submit} className="grid max-w-lg gap-4">
        <FormField
          id="current-password"
          name="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
        />
        <FormField
          id="new-password"
          name="newPassword"
          label="New password"
          hint="10 characters minimum"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
        />
        <FormMessage
          tone={message?.startsWith("Password changed") ? "success" : "error"}
        >
          {message}
        </FormMessage>
        <Button
          size="lg"
          type="submit"
          variant="secondary"
          className="w-fit"
          disabled={pending}
        >
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </Section>
  );
}

function ConnectionsSection({
  providers,
  connectedProviders,
}: Pick<AccountSettingsProps, "providers" | "connectedProviders">) {
  const pathname = usePathname();
  async function connect(provider: "google" | "microsoft") {
    await authClient.linkSocial({ provider, callbackURL: pathname });
  }

  return (
    <Section
      icon={<Link2 className="size-5" />}
      title="Connected accounts"
      description="Use a trusted identity provider to sign in."
    >
      <div className="grid gap-3">
        {(["google", "microsoft"] as const).map((provider) => {
          const connected = connectedProviders.includes(provider);
          const configured = providers[provider];
          return (
            <div
              key={provider}
              className="flex items-center justify-between gap-4 rounded-xl bg-muted/60 px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium capitalize">{provider}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {connected
                    ? "Connected"
                    : configured
                      ? "Available to connect"
                      : "OAuth credentials not configured"}
                </p>
              </div>
              <Button
                size="lg"
                variant="secondary"
                disabled={connected || !configured}
                onClick={() => connect(provider)}
              >
                {connected ? "Connected" : "Connect"}
              </Button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SessionsSection({
  sessionCount,
}: Pick<AccountSettingsProps, "sessionCount">) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function revoke() {
    setPending(true);
    const result = await authClient.revokeOtherSessions();
    setMessage(
      result.error
        ? (result.error.message ?? "Could not revoke sessions.")
        : "Other sessions have been signed out.",
    );
    setPending(false);
  }

  return (
    <Section
      icon={<MonitorSmartphone className="size-5" />}
      title="Sessions"
      description={`${sessionCount} active ${sessionCount === 1 ? "session" : "sessions"} for this account.`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          If you do not recognize recent activity, revoke every session except
          this browser and change your password.
        </p>
        <Button
          size="lg"
          variant="secondary"
          onClick={revoke}
          disabled={pending || sessionCount <= 1}
        >
          {pending ? "Revoking…" : "Sign out other sessions"}
        </Button>
      </div>
      <div className="mt-4">
        <FormMessage tone={message?.startsWith("Other") ? "success" : "error"}>
          {message}
        </FormMessage>
      </div>
    </Section>
  );
}

function DeleteSection({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const password = formValue(new FormData(event.currentTarget), "password");
    const result = await authClient.deleteUser({
      ...(hasPassword ? { password } : {}),
      callbackURL: "/",
    });
    if (result.error) {
      setError(result.error.message ?? "Account deletion failed.");
      setPending(false);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <section className="rounded-2xl bg-card p-5 shadow-[var(--shadow-border)] sm:p-6">
      <h2 className="font-semibold text-destructive">Delete account</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        This permanently removes your account and active sessions. This action
        cannot be undone.
      </p>
      {!open ? (
        <Button
          size="lg"
          variant="danger"
          className="mt-5"
          onClick={() => setOpen(true)}
        >
          Delete my account
        </Button>
      ) : (
        <form
          onSubmit={submit}
          className="mt-5 grid max-w-lg gap-4 rounded-xl bg-destructive/5 p-4"
        >
          {hasPassword ? (
            <FormField
              id="delete-password"
              name="password"
              label="Confirm with your password"
              type="password"
              autoComplete="current-password"
              required
            />
          ) : (
            <FormMessage tone="info">
              Confirm below to permanently delete this social sign-in account.
            </FormMessage>
          )}
          <FormMessage>{error}</FormMessage>
          <div className="flex gap-3">
            <Button size="lg" type="submit" variant="danger" disabled={pending}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
