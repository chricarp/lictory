"use client";

import { useId, useState, type InputHTMLAttributes } from "react";
import { Check, Eye, EyeOff } from "lucide-react";

import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export const MIN_PASSWORD_LENGTH = 10;

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  label: string;
  hint?: React.ReactNode;
};

/** Password input with a show/hide toggle. */
export function PasswordInput({
  label,
  hint,
  id,
  className,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[13px] font-medium">
          {label}
        </label>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          className={cn("pr-11", className)}
          {...props}
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-[color,background-color] duration-100 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

type Strength = {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
};

export function assessPassword(value: string): Strength {
  const length = value.length;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) =>
    re.test(value),
  ).length;

  if (length === 0) return { score: 0, label: "", hint: "" };
  if (length < MIN_PASSWORD_LENGTH) {
    const remaining = MIN_PASSWORD_LENGTH - length;
    return {
      score: 0,
      label: "Too short",
      hint: `${remaining} more character${remaining === 1 ? "" : "s"} needed.`,
    };
  }
  if (length >= 16 && classes >= 3) {
    return { score: 4, label: "Strong", hint: "Hard to guess. Nice." };
  }
  if (length >= 14 && classes >= 3) {
    return {
      score: 3,
      label: "Good",
      hint: "A few more characters would make it stronger.",
    };
  }
  if (length >= 12 && classes >= 2) {
    return {
      score: 2,
      label: "Fair",
      hint: "Mix in numbers or symbols to strengthen it.",
    };
  }
  return {
    score: 1,
    label: "Weak",
    hint: "Meets the minimum. A longer passphrase is much stronger.",
  };
}

const meterColor: Record<Strength["score"], string> = {
  0: "bg-destructive",
  1: "bg-destructive",
  2: "bg-amber-500",
  3: "bg-emerald-500",
  4: "bg-emerald-500",
};

/**
 * Password + confirmation pair for account creation and password reset.
 * Shows live strength guidance and confirms the two entries match.
 */
export function NewPasswordFields({
  autoFocus,
  passwordLabel = "Password",
  confirmationLabel = "Confirm password",
}: {
  autoFocus?: boolean;
  passwordLabel?: string;
  confirmationLabel?: string;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const feedbackId = useId();
  const matchId = useId();

  const strength = assessPassword(password);
  const showConfirmationState = confirmation.length > 0;
  const matches = password === confirmation;

  return (
    <>
      <div className="grid gap-2">
        <PasswordInput
          id="password"
          name="password"
          label={passwordLabel}
          hint={`${MIN_PASSWORD_LENGTH} characters minimum`}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          autoFocus={autoFocus}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-describedby={feedbackId}
        />
        <div
          id={feedbackId}
          aria-live="polite"
          className={cn(
            "grid gap-1.5 transition-opacity duration-150",
            password ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex flex-1 gap-1" aria-hidden>
              {[1, 2, 3, 4].map((step) => (
                <span
                  key={step}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-200",
                    step <= Math.max(strength.score, password ? 1 : 0)
                      ? meterColor[strength.score]
                      : "bg-border",
                  )}
                />
              ))}
            </div>
            <span className="min-w-14 text-right text-xs font-medium tabular-nums">
              {strength.label}
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {strength.hint || "\u00a0"}
          </p>
        </div>
      </div>

      <PasswordInput
        id="confirmation"
        name="confirmation"
        label={confirmationLabel}
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        required
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        aria-describedby={matchId}
        aria-invalid={showConfirmationState && !matches ? true : undefined}
        hint={
          showConfirmationState ? (
            <span
              id={matchId}
              className={cn(
                "inline-flex items-center gap-1",
                matches
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive",
              )}
            >
              {matches ? (
                <>
                  <Check className="size-3" strokeWidth={2.5} />
                  Passwords match
                </>
              ) : (
                "Passwords don’t match"
              )}
            </span>
          ) : (
            <span id={matchId} />
          )
        }
      />
    </>
  );
}
