import { useRouter } from "@lictory/platform/lib/navigation";
import { refreshSession } from "@lictory/platform/lib/session";
import { accountChanged } from "@lictory/platform/lib/account";
import { useEffect, useState } from "react";

import { FormMessage } from "@lictory/platform/components/auth/form-field";
import { Button } from "@lictory/ui/button";
import { Input } from "@lictory/ui/input";
import { useDebouncedCallback } from "@lictory/ui/use-debounced-callback";
import {
  HANDLE_MAX,
  handleProblem,
  normalizeHandle,
} from "@lictory/core/lib/handles";
import { cn } from "@lictory/core/lib/utils";

type Checked =
  | { handle: string; available: true }
  | { handle: string; available: false; reason: string };

export function HandleForm({
  initial,
  current = null,
  suggestions,
  next,
  submitLabel = "Continue",
  onSaved,
}: {
  initial: string;
  current?: string | null;
  suggestions: string[];
  // Where to go after saving; omit to stay and call `onSaved`.
  next?: string;
  submitLabel?: string;
  onSaved?: (handle: string) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  // Latest server answer; "checking" is any handle without an answer yet.
  const [checked, setChecked] = useState<Checked | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const handle = normalizeHandle(value);
  const problem = handle ? handleProblem(handle) : null;
  const unchanged = current !== null && handle === current;
  const needsCheck = !!handle && !problem && !unchanged;
  const result = checked?.handle === handle ? checked : null;

  const check = useDebouncedCallback((candidate: string) => {
    void fetch(`/api/handle?handle=${encodeURIComponent(candidate)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((answer: Checked | null) => {
        if (answer) setChecked(answer);
      })
      .catch(() => undefined);
  }, 250);

  function change(next: string) {
    setValue(next);
    setError(null);
    const candidate = normalizeHandle(next);
    if (candidate && !handleProblem(candidate) && candidate !== current)
      check(candidate);
  }

  // Check the prefilled suggestion once on mount.
  useEffect(() => {
    const candidate = normalizeHandle(initial);
    if (candidate && !handleProblem(candidate) && candidate !== current)
      check(candidate);
  }, [check, initial, current]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!handle || problem || unchanged) return;
    setError(null);
    setPending(true);
    const response = await fetch("/api/handle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      handle?: string;
      error?: { message: string };
    } | null;
    if (!response?.ok || !body?.handle) {
      setError(
        body?.error?.message ??
          "We could not save your handle. Check your connection and try again.",
      );
      setPending(false);
      return;
    }
    if (next) {
      await refreshSession().catch(() => undefined);
      router.replace(next);
      return;
    }
    setPending(false);
    onSaved?.(body.handle);
    void accountChanged();
  }

  const status = !handle
    ? null
    : problem
      ? { tone: "error", text: problem }
      : unchanged
        ? { tone: "muted", text: "This is your current handle." }
        : !result
          ? { tone: "muted", text: "Checking availability…" }
          : result.available
            ? { tone: "ok", text: `@${handle} is available.` }
            : { tone: "error", text: result.reason };
  const blocked =
    pending ||
    !handle ||
    !!problem ||
    unchanged ||
    (needsCheck && !result?.available);

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <div className="grid gap-1.5">
        <label htmlFor="handle" className="text-[13px] font-medium">
          Handle
        </label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
          >
            @
          </span>
          <Input
            id="handle"
            name="handle"
            value={value}
            onChange={(e) => change(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={HANDLE_MAX + 1}
            aria-describedby="handle-status"
            aria-invalid={status?.tone === "error" || undefined}
            className="pl-7"
            required
            autoFocus
          />
        </div>
        <p
          id="handle-status"
          aria-live="polite"
          className={cn(
            "min-h-5 text-xs leading-5",
            status?.tone === "error"
              ? "text-destructive"
              : status?.tone === "ok"
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-muted-foreground",
          )}
        >
          {status?.text ?? "Letters, numbers and underscores."}
        </p>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Suggestions:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => change(s)}
              className={cn(
                "rounded-md bg-muted px-2 py-1 font-medium text-foreground transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring",
                s === handle && "bg-primary/10 text-primary",
              )}
            >
              @{s}
            </button>
          ))}
        </div>
      )}
      <FormMessage>{error}</FormMessage>
      <Button
        size="lg"
        type="submit"
        className="mt-1 w-full"
        disabled={blocked}
      >
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
