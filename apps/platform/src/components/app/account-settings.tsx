import { usePathname, useRouter } from "@lictory/platform/lib/navigation";
import { useEffect, useState } from "react";
import {
  AtSign,
  Check,
  Monitor,
  Moon,
  Palette,
  Sun,
  KeyRound,
  Link2,
  Mail,
  MonitorSmartphone,
  Trash2,
  UserRound,
} from "lucide-react";

import { AgentAccessSection } from "@lictory/platform/components/app/agent-access";
import {
  PasskeysSection,
  TwoFactorSection,
} from "@lictory/platform/components/app/security-settings";
import { ProfilePhoto } from "@lictory/platform/components/app/profile-photo";
import { useAppearance } from "@lictory/platform/components/app/appearance-provider";
import { HandleForm } from "@lictory/platform/components/auth/handle-form";
import {
  ProviderIcon,
  isSocialProvider,
  providerLabel,
  socialProviders,
  type SocialProvider,
} from "@lictory/platform/components/auth/provider-icons";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Badge } from "@lictory/ui/primitives";
import {
  InlineError,
  SettingsBody,
  SettingsGroup,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import {
  THEMES,
  themeLabels,
  type Appearance,
  type Theme,
} from "@lictory/core/lib/appearance";
import { authClient } from "@lictory/platform/lib/auth-client";
import {
  accountChanged,
  forgetAccountLocally,
} from "@lictory/platform/lib/account";
import { useSessionUser } from "@lictory/platform/lib/session";
import { oauthErrorMessage } from "@lictory/core/lib/oauth-errors";
import { cn, formValue } from "@lictory/core/lib/utils";

type AccountSettingsProps = {
  user: {
    name: string;
    image: string | null;
    email: string;
    emailVerified: boolean;
    handle: string;
    twoFactorEnabled: boolean;
  };
  providers: Record<SocialProvider, boolean>;
  // Password sign-in can be turned off by the operator (SSO-only).
  signIn: { password: boolean; ssoName: string | null };
  // Sign-in methods on this account: "credential" (password) or a provider.
  accounts: { id: string; providerId: string }[];
  sessionCount: number;
  returnTo?: string;
  // Set by the provider redirect after connecting an account.
  connected?: string;
  connectionError?: string;
};

// Personal settings, laid out like organization settings: an anchor nav on the
// left and grouped cards on the right. Groups separate who you are from how
// you sign in, with the irreversible action kept apart at the end.
export function AccountSettings(props: AccountSettingsProps) {
  const hasPassword = props.accounts.some(
    (account) => account.providerId === "credential",
  );
  const nav = [
    { id: "profile", label: "Profile" },
    { id: "handle", label: "Handle" },
    { id: "email", label: "Email" },
    { id: "appearance", label: "Appearance" },
    ...(props.signIn.password ? [{ id: "password", label: "Password" }] : []),
    { id: "two-factor", label: "Two-factor" },
    ...(props.signIn.password ? [{ id: "passkeys", label: "Passkeys" }] : []),
    { id: "connections", label: "Connected accounts" },
    { id: "sessions", label: "Sessions" },
    { id: "agents", label: "AI agents" },
    { id: "delete", label: "Delete account" },
  ];

  return (
    <div className="mt-8 gap-10 lg:grid lg:grid-cols-[160px_minmax(0,1fr)]">
      <nav
        aria-label="Settings sections"
        className="hidden pt-14 lg:sticky lg:top-0 lg:block lg:self-start"
      >
        <ul className="space-y-0.5">
          {nav.map((n) => (
            <li key={n.id}>
              <a
                href={`#${n.id}`}
                className="block rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors duration-100 hover:bg-muted hover:text-foreground"
              >
                {n.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="space-y-10">
        <SettingsGroup
          title="Identity"
          description="How collaborators see you and where we reach you."
        >
          <ProfileSection user={props.user} />
          <HandleSection handle={props.user.handle} />
          <EmailSection user={props.user} />
        </SettingsGroup>

        <SettingsGroup
          title="Preferences"
          description="How Lictory looks for you, on every device you sign in to."
        >
          <AppearanceSection />
        </SettingsGroup>

        <SettingsGroup
          title="Sign-in & security"
          description="The ways you sign in and the devices currently signed in."
        >
          {!props.signIn.password ? null : hasPassword ? (
            <PasswordSection />
          ) : (
            <SetPasswordSection email={props.user.email} />
          )}
          <TwoFactorSection
            enabled={props.user.twoFactorEnabled}
            hasPassword={hasPassword}
            onChanged={() => void accountChanged()}
          />
          {props.signIn.password && <PasskeysSection />}
          <ConnectionsSection
            providers={props.providers}
            ssoName={props.signIn.ssoName}
            accounts={props.accounts}
            returnTo={props.returnTo}
            connected={props.connected}
            connectionError={props.connectionError}
          />
          <SessionsSection sessionCount={props.sessionCount} />
        </SettingsGroup>

        <SettingsGroup
          title="Integrations"
          description="AI agents that work in Lictory on your behalf."
        >
          <AgentAccessSection />
        </SettingsGroup>

        <SettingsGroup
          title="Danger zone"
          description="Irreversible actions on this account."
        >
          <DeleteSection hasPassword={hasPassword} />
        </SettingsGroup>
      </div>
    </div>
  );
}

// Compact labelled field matching the organization settings forms.
function Field({
  label,
  hint,
  id,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
}) {
  return (
    <label htmlFor={id} className="block text-[13px] font-medium">
      <span className="flex items-center justify-between gap-3">
        {label}
        {hint && (
          <span className="text-xs font-normal text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      <Input
        id={id}
        className={cn("mt-1.5 h-8 rounded-md text-sm", className)}
        {...props}
      />
    </label>
  );
}

// Outcome of the last submit, in the same quiet register as InlineError.
function Status({
  children,
  tone,
}: {
  children?: string | null;
  tone: "success" | "error";
}) {
  if (!children) return null;
  if (tone === "error") return <InlineError>{children}</InlineError>;
  return (
    <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
      {children}
    </p>
  );
}

function ProfileSection({ user }: Pick<AccountSettingsProps, "user">) {
  const [value, setValue] = useState(user.name);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dirty = value.trim() !== "" && value.trim() !== user.name;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await authClient.updateUser({ name: value.trim() });
    setMessage(
      result.error
        ? (result.error.message ?? "Update failed.")
        : "Profile updated.",
    );
    setPending(false);
    if (!result.error) void accountChanged();
  }

  return (
    <SettingsSection
      id="profile"
      icon={<UserRound />}
      title="Profile"
      description="Your name and photo, as shown to collaborators on threads and reviews."
    >
      <SettingsBody>
        <div className="mb-6">
          <ProfilePhoto name={user.name} image={user.image} />
        </div>
        <form onSubmit={submit} className="space-y-2">
          <label className="block text-[13px] font-medium">
            Full name
            <div className="mt-1.5 flex gap-2">
              <Input
                name="name"
                className="h-8 max-w-sm rounded-md text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="name"
                required
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={pending || !dirty}
              >
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </label>
          <Status tone={message === "Profile updated." ? "success" : "error"}>
            {message}
          </Status>
        </form>
      </SettingsBody>
    </SettingsSection>
  );
}

function HandleSection({ handle }: { handle: string }) {
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <SettingsSection
      id="handle"
      icon={<AtSign />}
      title="Handle"
      description="Unique across Lictory. People type it to mention and find you; existing mentions keep pointing to you when it changes."
    >
      <SettingsBody>
        <div className="max-w-sm space-y-2">
          <HandleForm
            key={handle}
            initial={handle}
            current={handle}
            suggestions={[]}
            submitLabel="Save handle"
            onSaved={(h) => setSaved(`Your handle is now @${h}.`)}
          />
          <Status tone="success">{saved}</Status>
        </div>
      </SettingsBody>
    </SettingsSection>
  );
}

function EmailSection({ user }: Pick<AccountSettingsProps, "user">) {
  const pathname = usePathname();
  const [value, setValue] = useState(user.email);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dirty = value.trim() !== "" && value.trim() !== user.email;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const result = await authClient.changeEmail({
      newEmail: value.trim(),
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
    <SettingsSection
      id="email"
      icon={<Mail />}
      title="Email"
      description="Sign-in address and where notifications are sent. A change takes effect once the new address is confirmed."
      action={
        user.emailVerified ? (
          <Badge tone="good">Verified</Badge>
        ) : (
          <Badge tone="warning">Unverified</Badge>
        )
      }
    >
      <SettingsBody>
        <form onSubmit={submit} className="space-y-2">
          <label className="block text-[13px] font-medium">
            Email address
            <div className="mt-1.5 flex gap-2">
              <Input
                name="email"
                type="email"
                className="h-8 max-w-sm rounded-md text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="email"
                required
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={pending || !dirty}
              >
                {pending ? "Sending…" : "Change"}
              </Button>
            </div>
          </label>
          <Status tone={message?.startsWith("Check") ? "success" : "error"}>
            {message}
          </Status>
        </form>
      </SettingsBody>
    </SettingsSection>
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
    <SettingsSection
      id="password"
      icon={<KeyRound />}
      title="Password"
      description="Changing it signs out every other session."
    >
      <SettingsBody>
        <form onSubmit={submit} className="max-w-sm space-y-3">
          <Field
            id="current-password"
            name="currentPassword"
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Field
            id="new-password"
            name="newPassword"
            label="New password"
            hint="10 characters minimum"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" variant="secondary" disabled={pending}>
              {pending ? "Updating…" : "Update password"}
            </Button>
            <Status
              tone={
                message?.startsWith("Password changed") ? "success" : "error"
              }
            >
              {message}
            </Status>
          </div>
        </form>
      </SettingsBody>
    </SettingsSection>
  );
}

function SetPasswordSection({ email }: { email: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  // Better Auth has no client endpoint to add a password without proving
  // control of the email address, so the reset link doubles as "set".
  async function send() {
    setPending(true);
    const result = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });
    setSent(!result.error);
    setMessage(
      result.error
        ? (result.error.message ?? "We could not send the link.")
        : `Check ${email} for a link to set your password.`,
    );
    setPending(false);
  }

  return (
    <SettingsSection
      id="password"
      icon={<KeyRound />}
      title="Password"
      description="You sign in through a connected account. Add a password to also sign in with your email address."
      action={<Badge>Not set</Badge>}
    >
      <SettingsBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-[13px] leading-5 text-muted-foreground">
          We email you a link to choose one. Setting it signs out every session,
          then you can sign in either way.
        </p>
        <div className="flex items-center gap-3">
          <Status tone={sent ? "success" : "error"}>{message}</Status>
          <Button
            size="sm"
            variant="secondary"
            onClick={send}
            disabled={pending || sent}
          >
            {pending ? "Sending…" : "Email me a link"}
          </Button>
        </div>
      </SettingsBody>
    </SettingsSection>
  );
}

const unlinkErrors: Record<string, string> = {
  SESSION_EXPIRED:
    "For your security, sign out and sign in again before disconnecting.",
  FAILED_TO_UNLINK_LAST_ACCOUNT:
    "This is your only way to sign in. Set a password first.",
};

function ConnectionsSection({
  providers,
  ssoName,
  accounts,
  returnTo,
  connected,
  connectionError,
}: Pick<
  AccountSettingsProps,
  "providers" | "accounts" | "returnTo" | "connected" | "connectionError"
> & { ssoName: string | null }) {
  const label = (provider: SocialProvider) => providerLabel(provider, ssoName);
  const router = useRouter();
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(() => {
    const error = oauthErrorMessage(connectionError, "connect");
    if (error) return { tone: "error", text: error };
    if (connected && isSocialProvider(connected))
      return {
        tone: "success",
        text: `${label(connected)} connected. You can now sign in with it.`,
      };
    return null;
  });
  const back = returnTo
    ? `/account?returnTo=${encodeURIComponent(returnTo)}`
    : "/account";

  // Returning from the provider: show the outcome where it happened, then
  // drop the one-time parameters so a reload doesn't repeat it.
  useEffect(() => {
    if (!connected && !connectionError) return;
    document.getElementById("connections")?.scrollIntoView({ block: "center" });
    router.replace(back, { scroll: false });
  }, [connected, connectionError, back, router]);

  const visible = socialProviders.filter(
    (provider) =>
      providers[provider] ||
      accounts.some((account) => account.providerId === provider),
  );
  const canDisconnect = accounts.length > 1;

  async function connect(provider: SocialProvider) {
    setPending(provider);
    setMessage(null);
    const result = await authClient.linkSocial({
      provider,
      callbackURL: `${back}${back.includes("?") ? "&" : "?"}connected=${provider}`,
      errorCallbackURL: back,
    });
    if (result.error) {
      setMessage({
        tone: "error",
        text:
          result.error.message ??
          `We couldn't reach ${label(provider)}. Try again.`,
      });
      setPending(null);
    }
  }

  async function disconnect(provider: SocialProvider, accountId: string) {
    setPending(provider);
    setMessage(null);
    const result = await authClient.unlinkAccount({ accountId });
    setPending(null);
    if (result.error) {
      setMessage({
        tone: "error",
        text:
          unlinkErrors[result.error.code ?? ""] ??
          result.error.message ??
          "Could not disconnect that account.",
      });
      return;
    }
    setMessage({
      tone: "success",
      text: `${label(provider)} disconnected. You can connect it again at any time.`,
    });
    void accountChanged();
  }

  return (
    <SettingsSection
      id="connections"
      icon={<Link2 />}
      title="Connected accounts"
      description="Sign in with an identity provider instead of, or alongside, a password. Only an account with the same email address can be connected."
      footer={
        message ? (
          <Status tone={message.tone}>{message.text}</Status>
        ) : undefined
      }
    >
      <SettingsList
        isEmpty={visible.length === 0}
        empty="No identity providers are enabled on this installation."
      >
        {visible.map((provider) => {
          const account = accounts.find((a) => a.providerId === provider);
          return (
            <div
              key={provider}
              className="flex items-center gap-3 px-5 py-2.5 text-[13px]"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted">
                <ProviderIcon provider={provider} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{label(provider)}</span>
                  {account && <Badge tone="good">Connected</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {!account
                    ? "Not connected."
                    : canDisconnect
                      ? "You can sign in with this account."
                      : "Your only way to sign in. Set a password before disconnecting it."}
                </p>
              </div>
              {account ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending !== null || !canDisconnect}
                  onClick={() => disconnect(provider, account.id)}
                >
                  {pending === provider ? "Disconnecting…" : "Disconnect"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending !== null || !providers[provider]}
                  onClick={() => connect(provider)}
                >
                  {pending === provider ? "Redirecting…" : "Connect"}
                </Button>
              )}
            </div>
          );
        })}
      </SettingsList>
    </SettingsSection>
  );
}

const appearanceOptions: {
  value: Appearance;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

// Roving selection for a radiogroup: arrow keys pick and focus the
// neighbouring option, wrapping at either end.
function arrowStep(event: React.KeyboardEvent<HTMLElement>, current: number) {
  const step =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (!step) return null;
  event.preventDefault();
  const buttons =
    event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
  const next = (current + step + buttons.length) % buttons.length;
  buttons[next]?.focus();
  return next;
}

function AppearanceSection() {
  const { appearance, setAppearance, theme, setTheme } = useAppearance();
  const [error, setError] = useState<string | null>(null);

  // Applied immediately; saved in the background and reverted if it fails.
  async function save(
    body: { appearance: Appearance } | { theme: Theme },
    revert: () => void,
  ) {
    setError(null);
    const response = await fetch("/api/appearance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response?.ok) {
      revert();
      const result = (await response?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(
        result?.error?.message ??
          "Appearance was not saved. Check your connection and try again.",
      );
    }
  }

  function chooseMode(next: Appearance) {
    if (next === appearance) return;
    const previous = appearance;
    setAppearance(next);
    void save({ appearance: next }, () => setAppearance(previous));
  }

  function chooseTheme(next: Theme) {
    if (next === theme) return;
    const previous = theme;
    setTheme(next);
    void save({ theme: next }, () => setTheme(previous));
  }

  return (
    <SettingsSection
      id="appearance"
      icon={<Palette />}
      title="Appearance"
      description="Every theme has a light and a dark variant. System follows your device and switches automatically when it does."
    >
      <SettingsBody className="space-y-5">
        <div className="space-y-2">
          <p id="appearance-mode-label" className="text-[13px] font-medium">
            Mode
          </p>
          {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- arrow keys bubble from the radios (roving tabindex); the WAI-ARIA radio group itself is not a tab stop. */}
          <div
            role="radiogroup"
            aria-labelledby="appearance-mode-label"
            className="inline-flex rounded-lg bg-muted p-0.5"
            onKeyDown={(event) => {
              const index = arrowStep(
                event,
                appearanceOptions.findIndex((o) => o.value === appearance),
              );
              const next = index === null ? null : appearanceOptions[index];
              if (next) chooseMode(next.value);
            }}
          >
            {appearanceOptions.map(({ value, label, icon: Icon }) => {
              const selected = appearance === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => chooseMode(value)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    selected
                      ? "bg-card font-medium text-foreground shadow-(--shadow-border)"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p id="appearance-theme-label" className="text-[13px] font-medium">
            Theme
          </p>
          {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus -- arrow keys bubble from the radios (roving tabindex); the WAI-ARIA radio group itself is not a tab stop. */}
          <div
            role="radiogroup"
            aria-labelledby="appearance-theme-label"
            className="grid grid-cols-2 gap-3 sm:grid-cols-3"
            onKeyDown={(event) => {
              const index = arrowStep(event, THEMES.indexOf(theme));
              const next = index === null ? null : THEMES[index];
              if (next) chooseTheme(next);
            }}
          >
            {THEMES.map((value) => {
              const selected = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={themeLabels[value]}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => chooseTheme(value)}
                  className={cn(
                    "group rounded-xl p-1 text-left transition-shadow duration-100 outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    selected
                      ? "shadow-[0_0_0_2px_var(--primary)]"
                      : "shadow-(--shadow-border) hover:shadow-(--shadow-border-hover)",
                  )}
                >
                  <span className="flex overflow-hidden rounded-lg">
                    <ThemePreview theme={value} />
                    <ThemePreview theme={value} dark />
                  </span>
                  <span className="flex items-center justify-between gap-2 px-1.5 pt-2 pb-1 text-[13px]">
                    <span className={cn(selected && "font-medium")}>
                      {themeLabels[value]}
                    </span>
                    {selected && (
                      <Check
                        aria-hidden
                        className="size-3.5 text-primary"
                        strokeWidth={2}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <Status tone="error">{error}</Status>
      </SettingsBody>
    </SettingsSection>
  );
}

// A miniature workspace drawn with the theme's own tokens: scoping the
// element to the theme (and to dark) makes the real palette apply inside it.
function ThemePreview({ theme, dark }: { theme: Theme; dark?: boolean }) {
  return (
    <span
      aria-hidden
      data-theme={theme}
      className={cn(
        "flex h-16 flex-1 gap-1 bg-background p-1.5",
        dark && "dark",
      )}
    >
      <span className="w-2.5 rounded-[3px] bg-sidebar shadow-[0_0_0_1px_var(--sidebar-border)]" />
      <span className="flex flex-1 flex-col gap-1 rounded-[4px] bg-card p-1.5 shadow-(--shadow-border)">
        <span className="h-1 w-4/5 rounded-full bg-foreground/70" />
        <span className="h-1 w-1/2 rounded-full bg-muted-foreground/50" />
        <span className="mt-auto flex gap-1">
          <span className="h-2 w-5 rounded-full bg-primary" />
          <span className="h-2 w-3 rounded-full bg-muted" />
        </span>
      </span>
    </span>
  );
}

function SessionsSection({
  sessionCount,
}: Pick<AccountSettingsProps, "sessionCount">) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const others = sessionCount - 1;

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
    <SettingsSection
      id="sessions"
      icon={<MonitorSmartphone />}
      title="Sessions"
      description="Browsers and devices currently signed in to this account, including this one."
      action={
        <span className="text-xs text-muted-foreground tabular-nums">
          {sessionCount} active {sessionCount === 1 ? "session" : "sessions"}
        </span>
      }
    >
      <SettingsBody className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-md text-[13px] leading-5 text-muted-foreground">
          {others > 0
            ? `Signs out ${others} other ${others === 1 ? "session" : "sessions"} and keeps this browser signed in. Change your password too if you do not recognize the activity.`
            : "This browser is the only active session."}
        </p>
        <div className="flex items-center gap-3">
          <Status tone={message?.startsWith("Other") ? "success" : "error"}>
            {message}
          </Status>
          <Button
            size="sm"
            variant="secondary"
            onClick={revoke}
            disabled={pending || others <= 0}
          >
            {pending ? "Revoking…" : "Sign out other sessions"}
          </Button>
        </div>
      </SettingsBody>
    </SettingsSection>
  );
}

function DeleteSection({ hasPassword }: { hasPassword: boolean }) {
  const userId = useSessionUser().id;
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
      setError(
        result.error.code === "SESSION_EXPIRED"
          ? "For your security, sign out and sign in again, then delete your account."
          : (result.error.message ?? "Account deletion failed."),
      );
      setPending(false);
      return;
    }
    await forgetAccountLocally(userId);
    window.location.assign("/sign-in");
  }

  return (
    <SettingsSection
      id="delete"
      icon={<Trash2 className="text-destructive" />}
      title="Delete account"
      description="Permanently removes your account and signs out every session. This cannot be undone."
      action={
        !open ? (
          <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
            Delete account…
          </Button>
        ) : undefined
      }
      className={cn(open && "ring-1 ring-destructive/30")}
    >
      {open ? (
        <SettingsBody className="bg-destructive/5">
          <form onSubmit={submit} className="max-w-sm space-y-3">
            {hasPassword ? (
              <Field
                id="delete-password"
                name="password"
                label="Confirm with your password"
                type="password"
                autoComplete="current-password"
                autoFocus
                required
              />
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Confirm below to permanently delete this account.
              </p>
            )}
            <InlineError>{error ?? undefined}</InlineError>
            <div className="flex gap-2 pt-1">
              <Button type="submit" variant="danger" disabled={pending}>
                {pending ? "Deleting…" : "Delete permanently"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </SettingsBody>
      ) : (
        <SettingsBody>
          <p className="text-[13px] text-muted-foreground">
            You will lose access to every organization you belong to.
            {hasPassword
              ? " You will be asked for your password to confirm."
              : ""}
          </p>
        </SettingsBody>
      )}
    </SettingsSection>
  );
}
