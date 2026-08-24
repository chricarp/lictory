"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Eye,
  Fingerprint,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRound,
} from "@/components/ui/icons";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth-client";
import {
  setUserPreferences,
  type ThemePreference,
  useUserPreferences,
} from "@/lib/preferences";
import { cn } from "@/lib/utils";

type SessionRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.listSessions>>["data"]
>[number];

type PasskeyRecord = NonNullable<
  Awaited<ReturnType<typeof authClient.passkey.listUserPasskeys>>["data"]
>[number];

type Loadable<T> =
  | { status: "loading"; data: T }
  | { status: "ready"; data: T }
  | { status: "error"; data: T; message: string };

function errorMessage(error: { message?: string } | null, fallback: string) {
  return error?.message ?? fallback;
}

function initialsFor(name: string) {
  return name
    .split(/[\s@.]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function describeClient(userAgent?: string | null) {
  if (!userAgent) {
    return { device: "Unknown device", browser: "Browser details unavailable" };
  }

  const device = /iPhone/i.test(userAgent)
    ? "iPhone"
    : /iPad/i.test(userAgent)
      ? "iPad"
      : /Android/i.test(userAgent)
        ? /Mobile/i.test(userAgent)
          ? "Android phone"
          : "Android tablet"
        : /Macintosh|Mac OS X/i.test(userAgent)
          ? "Mac"
          : /Windows/i.test(userAgent)
            ? "Windows PC"
            : /Linux/i.test(userAgent)
              ? "Linux device"
              : "Unknown device";
  const browser = /Edg\//i.test(userAgent)
    ? "Microsoft Edge"
    : /Firefox\//i.test(userAgent)
      ? "Firefox"
      : /CriOS\//i.test(userAgent)
        ? "Chrome on iOS"
        : /Chrome\//i.test(userAgent)
          ? "Google Chrome"
          : /Safari\//i.test(userAgent)
            ? "Safari"
            : "Unknown browser";

  return { device, browser };
}

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-16 items-center gap-4 border-t border-hairline py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-subtle">
          {description}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function AppearanceSettings() {
  const preferences = useUserPreferences();
  const themes: { value: ThemePreference; label: string }[] = [
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ];

  return (
    <Card id="preferences" className="scroll-mt-20">
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <Eye className="size-4 text-ember-bright" />
          <CardTitle>Appearance & accessibility</CardTitle>
        </div>
        <CardDescription>
          These preferences stay on this device and apply before Lictory loads.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SettingsRow
          title="Theme"
          description="Follow this device, or keep Lictory consistently light or dark."
        >
          <div
            className="flex rounded-lg border border-hairline-strong bg-canvas-raised p-1"
            aria-label="Theme"
          >
            {themes.map((theme) => (
              <button
                key={theme.value}
                type="button"
                aria-pressed={preferences.theme === theme.value}
                onClick={() =>
                  setUserPreferences({ ...preferences, theme: theme.value })
                }
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-xs font-medium transition-[background-color,color,box-shadow]",
                  preferences.theme === theme.value
                    ? "bg-surface-strong text-foreground shadow-sm"
                    : "text-subtle hover:text-muted",
                )}
              >
                {theme.label}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow
          title="Reduce motion"
          description="Minimise transitions and animated understanding states."
        >
          <Switch
            checked={preferences.reduceMotion}
            onCheckedChange={(reduceMotion) =>
              setUserPreferences({ ...preferences, reduceMotion })
            }
            aria-label="Reduce motion"
          />
        </SettingsRow>
        <SettingsRow
          title="Higher contrast"
          description="Strengthen borders, surfaces and secondary text."
        >
          <Switch
            checked={preferences.highContrast}
            onCheckedChange={(highContrast) =>
              setUserPreferences({ ...preferences, highContrast })
            }
            aria-label="Higher contrast"
          />
        </SettingsRow>
        <SettingsRow
          title="Larger text"
          description="Increase the interface text size while preserving responsive layout."
        >
          <Switch
            checked={preferences.largeText}
            onCheckedChange={(largeText) =>
              setUserPreferences({ ...preferences, largeText })
            }
            aria-label="Larger text"
          />
        </SettingsRow>
      </CardContent>
    </Card>
  );
}

function PasskeyRow({
  passkey,
  onRefresh,
}: {
  passkey: PasskeyRecord;
  onRefresh: () => Promise<void>;
}) {
  const [name, setName] = React.useState(passkey.name ?? "Unnamed passkey");
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  async function rename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === passkey.name) return;
    setSaving(true);
    const result = await authClient.passkey.updatePasskey({
      id: passkey.id,
      name: trimmed,
    });
    setSaving(false);
    if (result.error) {
      toast.error(errorMessage(result.error, "Could not rename passkey"));
      return;
    }
    toast.success("Passkey renamed");
    await onRefresh();
  }

  async function remove() {
    setRemoving(true);
    const result = await authClient.passkey.deletePasskey({ id: passkey.id });
    setRemoving(false);
    if (result.error) {
      toast.error(errorMessage(result.error, "Could not remove passkey"));
      return;
    }
    toast.success("Passkey removed");
    await onRefresh();
  }

  return (
    <div className="flex flex-col gap-3 border-t border-hairline py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--iris)/0.3)] bg-[rgb(var(--iris)/0.12)] text-[rgb(var(--iris))]">
        <Fingerprint className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void rename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          aria-label="Passkey name"
          className="h-8 max-w-sm border-transparent bg-transparent px-0 font-medium hover:border-hairline-strong hover:px-2 focus:px-2"
        />
        <p className="text-xs text-subtle">
          {passkey.deviceType === "multiDevice"
            ? "Synced passkey"
            : "Device-bound passkey"}
          {passkey.backedUp ? " · Backed up" : ""}
          {passkey.createdAt ? ` · Added ${formatDate(passkey.createdAt)}` : ""}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        loading={removing}
        disabled={saving}
        onClick={() => void remove()}
        className="self-start text-danger hover:bg-[rgb(var(--danger)/0.1)] hover:text-danger sm:self-auto"
      >
        <Trash2 />
        Remove
      </Button>
    </div>
  );
}

function SecuritySettings({
  email,
  onSessionRefresh,
}: {
  email: string;
  onSessionRefresh: () => Promise<unknown>;
}) {
  const [passkeys, setPasskeys] = React.useState<Loadable<PasskeyRecord[]>>({
    status: "loading",
    data: [],
  });
  const [addingPasskey, setAddingPasskey] = React.useState(false);
  const [passwords, setPasswords] = React.useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [changingPassword, setChangingPassword] = React.useState(false);
  const [revokeOnChange, setRevokeOnChange] = React.useState(true);

  const loadPasskeys = React.useCallback(async () => {
    const result = await authClient.passkey.listUserPasskeys();
    if (result.error) {
      setPasskeys({
        status: "error",
        data: [],
        message: errorMessage(result.error, "Could not load passkeys"),
      });
      return;
    }
    setPasskeys({ status: "ready", data: result.data ?? [] });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void authClient.passkey.listUserPasskeys().then((result) => {
      if (cancelled) return;
      if (result.error) {
        setPasskeys({
          status: "error",
          data: [],
          message: errorMessage(result.error, "Could not load passkeys"),
        });
        return;
      }
      setPasskeys({ status: "ready", data: result.data ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function addPasskey() {
    setAddingPasskey(true);
    const result = await authClient.passkey.addPasskey({
      name: "This device",
      authenticatorAttachment: "platform",
    });
    setAddingPasskey(false);
    if (result.error) {
      toast.error(errorMessage(result.error, "Could not add passkey"));
      return;
    }
    toast.success("Passkey added");
    await loadPasskeys();
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwords.next.length < 8) {
      toast.error("Your new password must be at least 8 characters");
      return;
    }
    if (passwords.next !== passwords.confirm) {
      toast.error("New passwords do not match");
      return;
    }
    setChangingPassword(true);
    let result = await authClient.changePassword({
      currentPassword: passwords.current,
      newPassword: passwords.next,
      revokeOtherSessions: revokeOnChange,
    });
    if (
      result.error &&
      /fresh|recent|expired/i.test(result.error.message ?? "")
    ) {
      const signIn = await authClient.signIn.email({
        email,
        password: passwords.current,
      });
      if (!signIn.error) {
        await onSessionRefresh();
        result = await authClient.changePassword({
          currentPassword: passwords.current,
          newPassword: passwords.next,
          revokeOtherSessions: revokeOnChange,
        });
      }
    }
    setChangingPassword(false);
    if (result.error) {
      toast.error(errorMessage(result.error, "Could not change password"));
      return;
    }
    setPasswords({ current: "", next: "", confirm: "" });
    toast.success("Password changed");
  }

  return (
    <Card id="security" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2.5">
          <Lock className="size-4 text-ember-bright" />
          <CardTitle>Sign-in & security</CardTitle>
          <Badge variant="success" className="ml-auto">
            <ShieldCheck /> Protected
          </Badge>
        </div>
        <CardDescription>
          Maintain your password and passwordless sign-in methods.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-7">
        <section aria-labelledby="passkeys-title">
          <div className="mb-4 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 id="passkeys-title" className="text-sm font-medium">
                Passkeys
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-subtle">
                Sign in with your fingerprint, face or device PIN.
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              loading={addingPasskey}
              onClick={() => void addPasskey()}
            >
              <Fingerprint /> Add passkey
            </Button>
          </div>

          {passkeys.status === "loading" ? (
            <div className="space-y-2">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ) : passkeys.status === "error" ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-4">
              <p className="text-sm text-danger">{passkeys.message}</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => void loadPasskeys()}
              >
                <RefreshCw /> Try again
              </Button>
            </div>
          ) : passkeys.data.length === 0 ? (
            <div className="rounded-lg border border-dashed border-hairline-strong px-5 py-7 text-center">
              <p className="text-sm font-medium">No passkeys yet</p>
              <p className="mt-1 text-xs text-subtle">
                Add this device for a faster, phishing-resistant sign-in.
              </p>
            </div>
          ) : (
            <div>
              {passkeys.data.map((passkey) => (
                <PasskeyRow
                  key={passkey.id}
                  passkey={passkey}
                  onRefresh={loadPasskeys}
                />
              ))}
            </div>
          )}
        </section>

        <form
          onSubmit={(event) => void changePassword(event)}
          className="border-t border-hairline pt-6"
        >
          <h3 className="text-sm font-medium">Change password</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-subtle">
            Use at least 8 characters and avoid passwords used elsewhere.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Current password" className="sm:col-span-2">
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={passwords.current}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    current: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="New password">
              <Input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={passwords.next}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    next: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Confirm new password">
              <Input
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={passwords.confirm}
                onChange={(event) =>
                  setPasswords((current) => ({
                    ...current,
                    confirm: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <label className="mt-4 flex cursor-pointer items-center gap-3 text-xs text-muted">
            <Switch
              checked={revokeOnChange}
              onCheckedChange={setRevokeOnChange}
              aria-label="Sign out other devices after password change"
            />
            Sign out all other devices after changing my password
          </label>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={changingPassword}
            className="mt-4"
          >
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function SessionSettings({
  currentToken,
  email,
  onSessionRefresh,
}: {
  currentToken: string;
  email: string;
  onSessionRefresh: () => Promise<unknown>;
}) {
  const router = useRouter();
  const [sessions, setSessions] = React.useState<Loadable<SessionRecord[]>>({
    status: "loading",
    data: [],
  });
  const [busyToken, setBusyToken] = React.useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = React.useState(false);
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [confirming, setConfirming] = React.useState(false);

  const loadSessions = React.useCallback(async () => {
    const result = await authClient.listSessions();
    if (result.error) {
      setSessions({
        status: "error",
        data: [],
        message: errorMessage(result.error, "Could not load active sessions"),
      });
      return;
    }
    setSessions({ status: "ready", data: result.data ?? [] });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void authClient.listSessions().then((result) => {
      if (cancelled) return;
      if (result.error) {
        setSessions({
          status: "error",
          data: [],
          message: errorMessage(result.error, "Could not load active sessions"),
        });
        return;
      }
      setSessions({ status: "ready", data: result.data ?? [] });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function revoke(token: string) {
    if (token === currentToken) {
      await authClient.signOut();
      router.replace("/login");
      return;
    }
    setBusyToken(token);
    const result = await authClient.revokeSession({ token });
    setBusyToken(null);
    if (result.error) {
      toast.error(errorMessage(result.error, "Could not sign out that device"));
      return;
    }
    toast.success("Device signed out");
    await loadSessions();
  }

  async function revokeOthers() {
    setRevokingOthers(true);
    const result = await authClient.revokeOtherSessions();
    setRevokingOthers(false);
    if (result.error) {
      toast.error(
        errorMessage(result.error, "Could not sign out other devices"),
      );
      return;
    }
    toast.success("Other devices signed out");
    await loadSessions();
  }

  async function confirmAccess(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirming(true);
    const result = await authClient.signIn.email({
      email,
      password: confirmPassword,
    });
    if (result.error) {
      setConfirming(false);
      toast.error(
        errorMessage(result.error, "Could not confirm your identity"),
      );
      return;
    }
    await onSessionRefresh();
    setConfirmPassword("");
    await loadSessions();
    setConfirming(false);
    toast.success("Identity confirmed");
  }

  const otherSessionCount = sessions.data.filter(
    (session) => session.token !== currentToken,
  ).length;

  return (
    <Card id="sessions" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2.5">
          <ShieldCheck className="size-4 text-ember-bright" />
          <CardTitle>Sessions & devices</CardTitle>
          {sessions.status === "ready" ? (
            <Badge className="ml-auto">{sessions.data.length} active</Badge>
          ) : null}
        </div>
        <CardDescription>
          Review where your account is signed in and remove access you no longer
          recognise.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessions.status === "loading" ? (
          <div className="space-y-3">
            {[0, 1].map((item) => (
              <Skeleton key={item} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : sessions.status === "error" &&
          /fresh|recent|expired/i.test(sessions.message) ? (
          <form
            onSubmit={(event) => void confirmAccess(event)}
            className="rounded-lg border border-[rgb(var(--ember)/0.3)] bg-[rgb(var(--ember)/0.07)] p-4"
          >
            <p className="text-sm font-medium">Confirm it’s you</p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted">
              Your sign-in is still active, but it is too old for sensitive
              account changes. Enter your password to view and revoke sessions.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Input
                type="password"
                autoComplete="current-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Current password"
                aria-label="Current password to confirm identity"
                required
                className="sm:max-w-sm"
              />
              <Button
                type="submit"
                variant="primary"
                loading={confirming}
                className="sm:self-start"
              >
                Confirm identity
              </Button>
            </div>
          </form>
        ) : sessions.status === "error" ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-4">
            <p className="text-sm text-danger">{sessions.message}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => void loadSessions()}
            >
              <RefreshCw /> Try again
            </Button>
          </div>
        ) : sessions.data.length === 0 ? (
          <div className="rounded-lg border border-dashed border-hairline-strong px-5 py-8 text-center">
            <p className="text-sm font-medium">No active sessions found</p>
            <p className="mt-1 text-xs text-subtle">
              Refresh if you recently signed in on this device.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.data
              .slice()
              .sort((left, right) =>
                left.token === currentToken
                  ? -1
                  : right.token === currentToken
                    ? 1
                    : new Date(right.updatedAt).getTime() -
                      new Date(left.updatedAt).getTime(),
              )
              .map((session) => {
                const client = describeClient(session.userAgent);
                const current = session.token === currentToken;
                return (
                  <div
                    key={session.id}
                    className={cn(
                      "flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center",
                      current
                        ? "border-[rgb(var(--ember)/0.36)] bg-[rgb(var(--ember)/0.07)]"
                        : "border-hairline bg-canvas-raised",
                    )}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-muted">
                      <Eye className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{client.device}</p>
                        {current ? (
                          <Badge variant="ember">This device</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-subtle">
                        {client.browser}
                        {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                      </p>
                      <p className="mt-1 text-[0.6875rem] text-subtle">
                        Last active {formatDate(session.updatedAt)} · Expires{" "}
                        {formatDate(session.expiresAt)}
                      </p>
                    </div>
                    <Button
                      variant={current ? "outline" : "ghost"}
                      size="sm"
                      loading={busyToken === session.token}
                      onClick={() => void revoke(session.token)}
                      className={cn(
                        "self-start sm:self-auto",
                        !current &&
                          "text-danger hover:bg-[rgb(var(--danger)/0.1)] hover:text-danger",
                      )}
                    >
                      <LogOut /> {current ? "Sign out" : "Revoke"}
                    </Button>
                  </div>
                );
              })}
          </div>
        )}

        {otherSessionCount > 0 ? (
          <div className="mt-5 flex flex-col gap-3 border-t border-hairline pt-5 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-subtle">
              Sign out {otherSessionCount} other{" "}
              {otherSessionCount === 1 ? "device" : "devices"} while keeping
              this one active.
            </p>
            <Button
              variant="outline"
              size="sm"
              loading={revokingOthers}
              onClick={() => void revokeOthers()}
            >
              Sign out all others
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ProfilePage() {
  const router = useRouter();
  const { data: session, refetch } = authClient.useSession();
  const [savingProfile, setSavingProfile] = React.useState(false);
  const profileKey = session
    ? `${session.user.id}:${session.user.name}:${session.user.image ?? ""}`
    : "";
  const [profile, setProfile] = React.useState({
    key: "",
    name: "",
    image: "",
  });

  if (profile.key !== profileKey) {
    setProfile({
      key: profileKey,
      name: session?.user.name ?? "",
      image: session?.user.image ?? "",
    });
  }

  if (!session) return null;

  const displayName = profile.name || session.user.email;

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = profile.name.trim();
    const image = profile.image.trim();
    if (!name) {
      toast.error("Add a name for your profile");
      return;
    }
    if (image) {
      try {
        new URL(image);
      } catch {
        toast.error("Profile photo must be a valid URL");
        return;
      }
    }

    setSavingProfile(true);
    const result = await authClient.updateUser({ name, image: image || null });
    setSavingProfile(false);
    if (result.error) {
      toast.error(errorMessage(result.error, "Could not update profile"));
      return;
    }
    await refetch();
    toast.success("Profile updated");
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="mb-7">
        <h1 className="text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">
          Profile & preferences
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Manage how Lictory looks and feels, how you sign in, and every device
          with access to your private context.
        </p>
      </header>

      <nav
        aria-label="Profile sections"
        className="mb-6 flex gap-2 overflow-x-auto pb-1 text-xs"
      >
        {[
          ["#profile", "Profile"],
          ["#preferences", "Preferences"],
          ["#security", "Security"],
          ["#sessions", "Sessions"],
        ].map(([href, label]) => (
          <a
            key={href}
            href={href}
            className="whitespace-nowrap rounded-full border border-hairline-strong bg-surface px-3 py-1.5 text-muted transition-colors hover:bg-surface-strong hover:text-foreground"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-5">
          <Card id="profile" className="scroll-mt-20">
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <UserRound className="size-4 text-ember-bright" />
                <CardTitle>Public identity</CardTitle>
              </div>
              <CardDescription>
                This is how your account appears inside your private Lictory
                space.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={(event) => void saveProfile(event)}>
                <div className="mb-5 flex items-center gap-4 rounded-lg border border-hairline bg-canvas-raised p-4">
                  <Avatar className="size-14">
                    {profile.image ? (
                      <AvatarImage src={profile.image} alt="" />
                    ) : null}
                    <AvatarFallback className="text-base">
                      {initialsFor(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{displayName}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="truncate text-xs text-subtle">
                        {session.user.email}
                      </p>
                      <Badge
                        variant={
                          session.user.emailVerified ? "success" : "warning"
                        }
                      >
                        {session.user.emailVerified ? "Verified" : "Unverified"}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Display name">
                    <Input
                      value={profile.name}
                      onChange={(event) =>
                        setProfile((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      autoComplete="name"
                      required
                    />
                  </Field>
                  <Field
                    label="Email address"
                    hint="Your email is the primary sign-in identifier."
                  >
                    <Input value={session.user.email} disabled type="email" />
                  </Field>
                  <Field
                    label="Profile photo URL"
                    hint="Leave blank to use your initials."
                    className="sm:col-span-2"
                  >
                    <Input
                      value={profile.image}
                      onChange={(event) =>
                        setProfile((current) => ({
                          ...current,
                          image: event.target.value,
                        }))
                      }
                      inputMode="url"
                      placeholder="https://…"
                    />
                  </Field>
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={savingProfile}
                  className="mt-5"
                >
                  Save profile
                </Button>
              </form>
            </CardContent>
          </Card>

          <AppearanceSettings />
          <SecuritySettings
            email={session.user.email}
            onSessionRefresh={refetch}
          />
          <SessionSettings
            currentToken={session.session.token}
            email={session.user.email}
            onSessionRefresh={refetch}
          />
        </div>

        <aside className="order-first lg:order-last lg:sticky lg:top-9">
          <Card className="overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-ember via-ember-bright to-[rgb(var(--iris))]" />
            <CardContent className="p-5">
              <p className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">
                Account overview
              </p>
              <dl className="mt-4 space-y-4 text-sm">
                <div>
                  <dt className="text-xs text-subtle">Member since</dt>
                  <dd className="mt-0.5 text-muted">
                    {formatDate(session.user.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">Privacy</dt>
                  <dd className="mt-0.5 flex items-center gap-1.5 text-muted">
                    <Lock className="size-3.5 text-success" /> Private by
                    default
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-subtle">Account ID</dt>
                  <dd
                    className="mt-0.5 truncate font-mono text-[0.6875rem] text-muted"
                    title={session.user.id}
                  >
                    {session.user.id}
                  </dd>
                </div>
              </dl>
              <div className="mt-5 border-t border-hairline pt-5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-danger hover:bg-[rgb(var(--danger)/0.1)] hover:text-danger"
                  onClick={async () => {
                    await authClient.signOut();
                    router.replace("/login");
                  }}
                >
                  <LogOut /> Sign out
                </Button>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
