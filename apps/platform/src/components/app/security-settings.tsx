import { useCallback, useEffect, useState } from "react";
import { Fingerprint, ShieldCheck } from "lucide-react";
import { encode } from "uqr";

import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { Badge } from "@lictory/ui/primitives";
import {
  InlineError,
  SettingsBody,
  SettingsList,
  SettingsSection,
} from "@lictory/platform/components/workspace/settings-section";
import { authClient } from "@lictory/platform/lib/auth-client";
import { formValue } from "@lictory/core/lib/utils";

// Better Auth error codes, when the error carries one.
const errorCode = (error: object) => (error as { code?: string }).code;

// Account settings → Sign-in & security: an authenticator app (TOTP) with
// one-time backup codes, and passkeys. Two-factor applies to password
// sign-ins; organizations can require it (docs/internals/two-factor-authentication.md).

function Notice({
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

// The otpauth:// URI as a QR code for authenticator apps. The setup key next
// to it is the same secret for typing in by hand.
function QrCode({ value }: { value: string }) {
  const { data, size } = encode(value, { border: 2 });
  const path = data
    .flatMap((row, y) =>
      row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")),
    )
    .join("");
  return (
    <svg
      role="img"
      aria-label="QR code to scan with your authenticator app"
      viewBox={`0 0 ${size} ${size}`}
      className="size-40 shrink-0 rounded-md bg-white"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

function setupKey(totpURI: string) {
  try {
    return new URL(totpURI).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

function BackupCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-5">
        Save these backup codes somewhere safe, like a password manager. Each
        code signs you in once if you lose your authenticator app.{" "}
        <strong className="font-medium">They are shown only now.</strong>
      </p>
      <ul
        aria-label="Backup codes"
        className="grid max-w-sm grid-cols-2 gap-x-6 gap-y-1 rounded-md bg-muted px-4 py-3 font-mono text-[13px]"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard
            ?.writeText(codes.join("\n"))
            .then(() => setCopied(true))
            .catch(() => setCopied(false));
        }}
      >
        {copied ? "Copied" : "Copy codes"}
      </Button>
    </div>
  );
}

// Accounts with a password confirm it; accounts without one (Google or
// Microsoft only) need none (Better Auth's `allowPasswordless`).
const passwordBody = (password?: string) =>
  (password ? { password } : {}) as { password: string };

type Step =
  | { name: "idle" }
  | { name: "password"; action: "enable" | "regenerate" | "disable" }
  | { name: "verify"; totpURI: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[]; title: string };

export function TwoFactorSection({
  enabled,
  hasPassword,
  onChanged,
}: {
  enabled: boolean;
  hasPassword: boolean;
  onChanged: () => void;
}) {
  const [step, setStep] = useState<Step>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Keyboard users land on the field the next step needs.
  useEffect(() => {
    const id =
      step.name === "password"
        ? "two-factor-password"
        : step.name === "verify"
          ? "two-factor-setup-code"
          : undefined;
    if (id) document.getElementById(id)?.focus();
  }, [step.name]);

  // Reloads the account and the session (organizations it opens).
  const changed = onChanged;

  async function run(
    action: "enable" | "regenerate" | "disable",
    password?: string,
  ) {
    setPending(true);
    setError(null);
    setSuccess(null);
    if (action === "enable") {
      const result = await authClient.twoFactor.enable(passwordBody(password));
      setPending(false);
      if (result.error || !result.data || !("totpURI" in result.data)) {
        setError(
          result.error?.message ??
            "Two-factor setup could not start. Try again.",
        );
        return;
      }
      setStep({
        name: "verify",
        totpURI: result.data.totpURI,
        backupCodes: result.data.backupCodes,
      });
      return;
    }
    if (action === "regenerate") {
      const result = await authClient.twoFactor.generateBackupCodes(
        passwordBody(password),
      );
      setPending(false);
      if (result.error || !result.data) {
        setError(result.error?.message ?? "New backup codes were not created.");
        return;
      }
      setStep({
        name: "codes",
        backupCodes: result.data.backupCodes,
        title: "New backup codes. The previous codes no longer work.",
      });
      return;
    }
    const result = await authClient.twoFactor.disable(passwordBody(password));
    setPending(false);
    if (result.error) {
      setError(
        errorCode(result.error) === "SESSION_EXPIRED" ||
          errorCode(result.error) === "SESSION_NOT_FRESH"
          ? "For your security, sign out and sign in again before turning off two-factor authentication."
          : (result.error.message ??
              "Two-factor authentication is still on. Try again."),
      );
      return;
    }
    setStep({ name: "idle" });
    setSuccess("Two-factor authentication is off.");
    changed();
  }

  function start(action: "enable" | "regenerate" | "disable") {
    setError(null);
    setSuccess(null);
    if (hasPassword) setStep({ name: "password", action });
    else void run(action);
  }

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.name !== "verify") return;
    setPending(true);
    setError(null);
    const code = formValue(new FormData(event.currentTarget), "code").replace(
      /\s+/g,
      "",
    );
    const result = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (result.error) {
      setError(
        "That code is not valid. Check the time on your device and enter the current code.",
      );
      return;
    }
    setStep({
      name: "codes",
      backupCodes: step.backupCodes,
      title: "Two-factor authentication is on.",
    });
    changed();
  }

  const passwordLabels = {
    enable: "Continue",
    regenerate: "Create new backup codes",
    disable: "Turn off two-factor",
  } as const;

  return (
    <SettingsSection
      id="two-factor"
      icon={<ShieldCheck />}
      title="Two-factor authentication"
      description="After your password, sign-in asks for a code from an authenticator app such as 1Password, Google Authenticator or Microsoft Authenticator."
      action={enabled ? <Badge tone="good">On</Badge> : <Badge>Off</Badge>}
      footer={
        enabled
          ? "Lost your device and your backup codes? An administrator of an organization you belong to can reset your two-factor authentication."
          : undefined
      }
    >
      <SettingsBody className="space-y-4">
        {step.name === "idle" && (
          <div className="flex flex-wrap items-center gap-2">
            {enabled ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => start("regenerate")}
                >
                  New backup codes
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => start("disable")}
                >
                  Turn off
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => start("enable")}
              >
                {pending ? "Starting…" : "Set up authenticator app"}
              </Button>
            )}
          </div>
        )}

        {step.name === "password" && (
          <form
            className="max-w-sm space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                step.action,
                formValue(new FormData(event.currentTarget), "password"),
              );
            }}
          >
            {step.action === "disable" && (
              <p className="text-[13px] leading-5">
                Without it, your password alone signs you in. Organizations that
                require two-factor authentication stay closed to you until you
                turn it on again.
              </p>
            )}
            <label
              htmlFor="two-factor-password"
              className="block text-[13px] font-medium"
            >
              Confirm with your password
              <Input
                id="two-factor-password"
                name="password"
                type="password"
                autoComplete="current-password"
                className="mt-1.5 h-8 rounded-md text-sm"
                required
              />
            </label>
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                variant={step.action === "disable" ? "danger" : "secondary"}
                disabled={pending}
              >
                {pending ? "Checking…" : passwordLabels[step.action]}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setStep({ name: "idle" })}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {step.name === "verify" && (
          <div className="flex flex-col gap-5 sm:flex-row">
            <QrCode value={step.totpURI} />
            <form className="max-w-sm min-w-0 space-y-3" onSubmit={verify}>
              <p className="text-[13px] leading-5">
                Scan the QR code with your authenticator app, or enter the setup
                key by hand. Then enter the 6-digit code it shows.
              </p>
              <div className="text-[13px]">
                <span className="font-medium">Setup key</span>
                <code
                  data-testid="two-factor-setup-key"
                  className="mt-1 block rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all select-all"
                >
                  {setupKey(step.totpURI)}
                </code>
              </div>
              <label
                htmlFor="two-factor-setup-code"
                className="block text-[13px] font-medium"
              >
                Code from your app
                <Input
                  id="two-factor-setup-code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]{6,7}"
                  maxLength={7}
                  className="mt-1.5 h-8 max-w-40 rounded-md text-sm"
                  required
                />
              </label>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                >
                  {pending ? "Verifying…" : "Turn on"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setStep({ name: "idle" })}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {step.name === "codes" && (
          <div className="space-y-3">
            <p role="status" className="text-[13px] font-medium">
              {step.title}
            </p>
            <BackupCodes codes={step.backupCodes} />
            <Button size="sm" onClick={() => setStep({ name: "idle" })}>
              I saved my backup codes
            </Button>
          </div>
        )}

        <InlineError>{error ?? undefined}</InlineError>
        <Notice tone="success">{success}</Notice>
      </SettingsBody>
    </SettingsSection>
  );
}

type PasskeyRow = {
  id: string;
  name?: string | null;
  createdAt?: string | Date;
};

export function PasskeysSection() {
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const supported = typeof window.PublicKeyCredential === "function";

  const load = useCallback(
    () =>
      authClient.passkey.listUserPasskeys().then((result) => {
        if (result.error) setError("Your passkeys could not be loaded.");
        else setPasskeys(result.data ?? []);
      }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const name = formValue(new FormData(form), "name").trim();
    setPending("add");
    setError(null);
    setSuccess(null);
    const result = await authClient.passkey.addPasskey({
      ...(name ? { name } : {}),
    });
    setPending(null);
    if (result?.error) {
      setError(
        errorCode(result.error) === "SESSION_NOT_FRESH" ||
          errorCode(result.error) === "SESSION_EXPIRED"
          ? "For your security, sign out and sign in again before adding a passkey."
          : errorCode(result.error) === "AUTH_CANCELLED" ||
              errorCode(result.error) === "ERROR_CEREMONY_ABORTED"
            ? "Adding the passkey was cancelled."
            : (result.error.message ?? "The passkey was not added."),
      );
      return;
    }
    form.reset();
    setSuccess("Passkey added. You can sign in with it.");
    await load();
  }

  async function remove(passkey: PasskeyRow) {
    setPending(passkey.id);
    setError(null);
    setSuccess(null);
    const result = await authClient.passkey.deletePasskey({ id: passkey.id });
    setPending(null);
    if (result.error) {
      setError(result.error.message ?? "The passkey was not removed.");
      return;
    }
    setSuccess(
      "Passkey removed. Also delete it from your device or password manager.",
    );
    await load();
  }

  return (
    <SettingsSection
      id="passkeys"
      icon={<Fingerprint />}
      title="Passkeys"
      description="Sign in with your device's fingerprint, face or screen lock, or a security key, instead of your password."
      footer={
        <>
          Passkeys are another way to sign in. They do not replace two-factor
          authentication for password sign-ins.
        </>
      }
    >
      <SettingsList isEmpty={passkeys?.length === 0} empty="No passkeys yet.">
        {(passkeys ?? []).map((passkey) => (
          <div
            key={passkey.id}
            className="flex items-center gap-3 px-5 py-2.5 text-[13px]"
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              {passkey.name ?? "Passkey"}
            </span>
            {passkey.createdAt && (
              <span className="text-xs text-muted-foreground">
                Added {new Date(passkey.createdAt).toLocaleDateString()}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending !== null}
              aria-label={`Remove passkey ${passkey.name ?? ""}`.trim()}
              onClick={() => remove(passkey)}
            >
              {pending === passkey.id ? "Removing…" : "Remove"}
            </Button>
          </div>
        ))}
      </SettingsList>
      <SettingsBody className="space-y-2 border-t border-border">
        {supported ? (
          <form onSubmit={add} className="flex max-w-md items-end gap-2">
            <label
              htmlFor="passkey-name"
              className="block flex-1 text-[13px] font-medium"
            >
              Passkey name
              <Input
                id="passkey-name"
                name="name"
                placeholder="e.g. Work laptop"
                maxLength={80}
                className="mt-1.5 h-8 rounded-md text-sm"
              />
            </label>
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={pending !== null}
            >
              {pending === "add" ? "Waiting for your device…" : "Add passkey"}
            </Button>
          </form>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            This browser does not support passkeys.
          </p>
        )}
        <InlineError>{error ?? undefined}</InlineError>
        <Notice tone="success">{success}</Notice>
      </SettingsBody>
    </SettingsSection>
  );
}
