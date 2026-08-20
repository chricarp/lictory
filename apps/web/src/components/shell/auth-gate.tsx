"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  Fingerprint,
  Lock,
  Mail,
  ShieldCheck,
  UserRound,
} from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

type Mode = "sign-in" | "sign-up";

export function AuthGate({
  children,
  redirectTo,
}: {
  children: React.ReactNode;
  redirectTo?: string;
}) {
  const router = useRouter();
  const { data: session, isPending, refetch } = authClient.useSession();
  const [mode, setMode] = React.useState<Mode>("sign-in");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");

  React.useEffect(() => {
    if (
      typeof PublicKeyCredential === "undefined" ||
      !PublicKeyCredential.isConditionalMediationAvailable
    ) {
      return;
    }
    void PublicKeyCredential.isConditionalMediationAvailable().then(
      (available) => {
        if (available) void authClient.signIn.passkey({ autoFill: true });
      },
    );
  }, []);

  React.useEffect(() => {
    if (!isPending && !session && redirectTo) router.replace(redirectTo);
  }, [isPending, redirectTo, router, session]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    if (result.error) {
      setMessage(result.error.message ?? "Authentication failed.");
    } else {
      setPassword("");
      await refetch();
    }
    setBusy(false);
  }

  async function social(provider: "google" | "apple") {
    setBusy(true);
    setMessage("");
    const result = await authClient.signIn.social({
      provider,
      callbackURL: `${window.location.origin}/app`,
    });
    if (result.error) {
      setMessage(result.error.message ?? `Could not sign in with ${provider}.`);
      setBusy(false);
    }
  }

  async function signInWithPasskey() {
    setBusy(true);
    setMessage("");
    const result = await authClient.signIn.passkey();
    if (result.error) {
      setMessage(result.error.message ?? "Passkey sign-in failed.");
    } else {
      await refetch();
    }
    setBusy(false);
  }

  if (isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <motion.div
          className="flex flex-col items-center gap-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <motion.span
            className="flex size-12 items-center justify-center rounded-md bg-ember text-sm font-bold tracking-[-0.08em] text-white"
            animate={{ opacity: [0.6, 1, 0.6] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          >
            LI
          </motion.span>
          <p className="text-sm text-subtle">Checking your session…</p>
        </motion.div>
      </div>
    );
  }

  if (session) return <>{children}</>;

  if (redirectTo) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-subtle">Taking you to sign in…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-5xl flex-col justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="grid overflow-hidden rounded-xl border border-hairline-strong bg-canvas-raised shadow-[0_28px_90px_rgb(0_0_0/0.22)] md:grid-cols-[0.8fr_1.2fr]"
      >
        <div className="atlas-grid hidden border-r border-hairline p-8 md:flex md:flex-col md:justify-between">
          <span className="flex size-10 items-center justify-center rounded-md bg-ember text-xs font-bold tracking-[-0.08em] text-white">
            LI
          </span>
          <div>
            <p className="index-kicker mb-4">Private by default</p>
            <p className="text-2xl font-semibold leading-tight tracking-[-0.035em]">
              Keep the whole moment, all in one place.
            </p>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <span className="mb-5 inline-flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-ember-bright">
            <ShieldCheck className="size-3.5" /> Private by default
          </span>

          <h1 className="mb-1.5 text-xl font-semibold tracking-tight">
            {mode === "sign-in" ? "Welcome back" : "Create your space"}
          </h1>
          <p className="mb-6 text-sm leading-relaxed text-muted">
            {mode === "sign-in"
              ? "Everything you have captured is waiting where you left it."
              : "Keep notes, voice, photos and files together in one private place."}
          </p>

          <div className="mb-5 grid gap-2">
            <Button
              variant="secondary"
              size="lg"
              disabled={busy}
              onClick={() => void social("google")}
            >
              Continue with Google
            </Button>
            <Button
              variant="secondary"
              size="lg"
              disabled={busy}
              onClick={() => void social("apple")}
            >
              Continue with Apple
            </Button>
            <Button
              variant="outline"
              size="lg"
              disabled={busy}
              onClick={() => void signInWithPasskey()}
            >
              <Fingerprint />
              Use a passkey
            </Button>
          </div>

          <div className="mb-5 flex items-center gap-3">
            <span className="h-px flex-1 bg-hairline" />
            <span className="text-[0.6875rem] uppercase tracking-[0.12em] text-subtle">
              or with email
            </span>
            <span className="h-px flex-1 bg-hairline" />
          </div>

          <form
            onSubmit={(event) => void submit(event)}
            className="grid gap-3.5"
          >
            <AnimatePresence initial={false}>
              {mode === "sign-up" ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <Field label="Name">
                    <div className="relative">
                      <UserRound className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                      <Input
                        autoComplete="name"
                        required
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        className="pl-9"
                      />
                    </div>
                  </Field>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <Field label="Email">
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                <Input
                  autoComplete="email webauthn"
                  inputMode="email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="pl-9"
                />
              </div>
            </Field>

            <Field label="Password">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                <Input
                  autoComplete={
                    mode === "sign-up"
                      ? "new-password"
                      : "current-password webauthn"
                  }
                  minLength={8}
                  type="password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="pl-9"
                />
              </div>
            </Field>

            <Button type="submit" variant="primary" size="lg" loading={busy}>
              {mode === "sign-up" ? "Create account" : "Sign in"}
            </Button>
          </form>

          <AnimatePresence>
            {message ? (
              <motion.p
                role="alert"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4 rounded-md border border-[rgb(var(--danger)/0.3)] bg-[rgb(var(--danger)/0.08)] px-3 py-2 text-xs text-danger"
              >
                {message}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <p className="mt-5 text-center text-xs text-subtle">
            {mode === "sign-in"
              ? "New to Lictory?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() =>
                setMode((current) =>
                  current === "sign-in" ? "sign-up" : "sign-in",
                )
              }
              className={cn("font-medium text-ember-bright hover:underline")}
            >
              {mode === "sign-in" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
