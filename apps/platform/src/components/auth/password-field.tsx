import {
  useId,
  useState,
  type ComponentProps,
  type InputHTMLAttributes,
} from "react";
import {
  PasswordInput as PasswordInputRoot,
  PasswordInputControl,
  PasswordInputToggle,
} from "@ui-sdk/react/password-input";
import { Check, Eye, EyeOff } from "lucide-react";

import { inputClass } from "@lictory/ui/input";
import {
  FieldError,
  useFieldError,
} from "@lictory/platform/components/auth/form-field";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  stripWhitespace,
} from "@lictory/core/lib/password-policy";
import { cn } from "@lictory/core/lib/utils";

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH };

type Root = ComponentProps<typeof PasswordInputRoot>;

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue" | "onChange" | "children" | "onSelect"
> &
  Pick<Root, "value" | "defaultValue" | "onValueChange"> & {
    label: string;
    hint?: React.ReactNode;
    /** Decoration rendered over the input, e.g. a strength meter. */
    overlay?: React.ReactNode;
  };

/** Password input with a show/hide toggle. */
export function PasswordInput({
  label,
  hint,
  overlay,
  id,
  className,
  name,
  form,
  value,
  defaultValue,
  onValueChange,
  autoComplete,
  required,
  disabled,
  readOnly,
  "aria-describedby": describedBy,
  ...props
}: PasswordInputProps) {
  const { error, errorId, fieldProps } = useFieldError(id, describedBy);
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
      <PasswordInputRoot
        className="relative block h-auto bg-transparent outline-none data-disabled:opacity-100"
        name={name}
        form={form}
        value={value}
        defaultValue={defaultValue}
        onValueChange={onValueChange}
        autoComplete={autoComplete}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
      >
        <PasswordInputControl
          id={id}
          className={cn(inputClass, "pr-11", className)}
          {...props}
          {...fieldProps}
        />
        <PasswordInputToggle
          className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-default place-items-center rounded-lg text-muted-foreground transition-[color,background-color] duration-100 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]"
          render={(toggle, { visible }) => (
            <button
              {...toggle}
              // The part points at a generated id, not the id given to the
              // field.
              {...(id ? { "aria-controls": id } : null)}
              aria-label={visible ? "Hide password" : "Show password"}
            >
              {visible ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          )}
        />
        {overlay}
      </PasswordInputRoot>
      <FieldError id={errorId}>{error}</FieldError>
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
  2: "bg-warning",
  3: "bg-success",
  4: "bg-success",
};

const meterText: Record<Strength["score"], string> = {
  0: "text-destructive",
  1: "text-destructive",
  2: "text-warning",
  3: "text-success",
  4: "text-success",
};

/** Drops whitespace (typed or pasted) and caps the length. */
function sanitize(value: string): string {
  return stripWhitespace(value).slice(0, MAX_PASSWORD_LENGTH);
}

/**
 * Password + confirmation pair for account creation and password reset.
 * Shows live strength guidance and confirms the two entries match.
 */
export function NewPasswordFields({
  autoFocus,
  passwordLabel = "Password",
  confirmationLabel = "Confirm password",
  confirm = true,
}: {
  autoFocus?: boolean;
  passwordLabel?: string;
  confirmationLabel?: string;
  // Sign-up relies on the visibility toggle instead of a second entry.
  confirm?: boolean;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const feedbackId = useId();
  const matchId = useId();

  const strength = assessPassword(password);
  const hasPassword = password.length > 0;
  const showConfirmationState = confirmation.length > 0;
  const matches = password === confirmation;

  return (
    <>
      <PasswordInput
        id="password"
        name="password"
        label={passwordLabel}
        hint={
          // Swaps in place of the minimum-length hint so nothing reflows.
          <span className="relative inline-grid justify-items-end">
            <span
              aria-hidden={hasPassword}
              className={cn(
                "col-start-1 row-start-1 transition-[opacity,transform] duration-200 ease-out",
                hasPassword && "-translate-y-1 opacity-0",
              )}
            >
              {MIN_PASSWORD_LENGTH}–{MAX_PASSWORD_LENGTH} characters, no spaces
            </span>
            <span
              aria-hidden
              title={strength.hint}
              className={cn(
                "col-start-1 row-start-1 font-medium transition-[opacity,transform,color] duration-200 ease-out",
                meterText[strength.score],
                hasPassword ? "opacity-100" : "translate-y-1 opacity-0",
              )}
            >
              {strength.label}
            </span>
          </span>
        }
        overlay={
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-5 bottom-1 flex gap-1 transition-[opacity,transform] duration-200 ease-out",
              hasPassword ? "opacity-100" : "scale-x-95 opacity-0",
            )}
          >
            {[1, 2, 3, 4].map((step) => (
              <span
                key={step}
                className={cn(
                  "h-0.5 flex-1 rounded-full transition-colors duration-300",
                  step <= Math.max(strength.score, 1)
                    ? meterColor[strength.score]
                    : "bg-border",
                )}
              />
            ))}
          </div>
        }
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={MAX_PASSWORD_LENGTH}
        required
        autoFocus={autoFocus}
        value={password}
        onValueChange={(value) => setPassword(sanitize(value))}
        aria-describedby={feedbackId}
      />
      <span id={feedbackId} aria-live="polite" className="sr-only">
        {hasPassword ? `${strength.label}. ${strength.hint}` : ""}
      </span>

      {confirm && (
        <PasswordInput
          id="confirmation"
          name="confirmation"
          label={confirmationLabel}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          required
          value={confirmation}
          onValueChange={(value) => setConfirmation(sanitize(value))}
          aria-describedby={matchId}
          aria-invalid={showConfirmationState && !matches ? true : undefined}
          hint={
            showConfirmationState ? (
              <span
                id={matchId}
                className={cn(
                  "inline-flex items-center gap-1",
                  matches ? "text-success" : "text-destructive",
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
      )}
    </>
  );
}
