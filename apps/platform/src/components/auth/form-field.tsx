import {
  createContext,
  useContext,
  useState,
  type FormEvent,
  type FormHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { Input } from "@lictory/ui/input";

// Forms check their fields when submitted and show what is wrong next to
// each field, in words that stay until the field is fixed: never the
// browser's own bubbles, which show one field at a time and vanish on the
// next key. The first field to fix takes focus; its message is its
// description, so a screen reader reads it there.

type FieldErrors = ReadonlyMap<string, string>;

const FieldErrorsContext = createContext<FieldErrors>(new Map());

// What is wrong with a field, in words, from the browser's constraint
// validation (required, type, length, pattern).
export function fieldError(
  field: Pick<
    HTMLInputElement,
    "validity" | "validationMessage" | "minLength" | "title" | "type"
  > & { labels: ArrayLike<{ textContent: string | null }> | null },
): string | null {
  const { validity } = field;
  if (validity.valid) return null;
  const label = field.labels?.[0]?.textContent?.trim() ?? "This field";
  if (validity.valueMissing) return `${label} is required.`;
  if (validity.typeMismatch && field.type === "email")
    return "Enter an email address like name@company.com.";
  if (validity.tooShort)
    return `${label} needs at least ${field.minLength} characters.`;
  if (validity.patternMismatch && field.title) return field.title;
  return field.validationMessage || `${label} is not valid.`;
}

function invalidFields(form: HTMLFormElement) {
  return [...form.elements].filter(
    (element): element is HTMLInputElement =>
      element instanceof HTMLInputElement &&
      !!element.id &&
      !element.validity.valid,
  );
}

// A form whose fields (`FormField`, `PasswordInput`) show their own errors.
// `onSubmit` runs only when every field is valid.
export function ValidatedForm({
  onSubmit,
  children,
  ...props
}: Omit<FormHTMLAttributes<HTMLFormElement>, "onSubmit" | "noValidate"> & {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [errors, setErrors] = useState<FieldErrors>(new Map());
  return (
    <FieldErrorsContext value={errors}>
      <form
        {...props}
        noValidate
        onSubmit={(event) => {
          const invalid = invalidFields(event.currentTarget);
          if (!invalid.length) {
            setErrors(new Map());
            onSubmit(event);
            return;
          }
          event.preventDefault();
          setErrors(
            new Map(invalid.map((field) => [field.id, fieldError(field)!])),
          );
          invalid[0]!.focus();
        }}
        // A fixed field drops its message as soon as it is valid.
        onInput={(event) => {
          const field = event.target;
          if (!(field instanceof HTMLInputElement) || !errors.has(field.id))
            return;
          const error = fieldError(field);
          if (error === errors.get(field.id)) return;
          const next = new Map(errors);
          if (error) next.set(field.id, error);
          else next.delete(field.id);
          setErrors(next);
        }}
      >
        {errors.size > 1 && (
          <p className="text-[13px] leading-5 text-destructive">
            {errors.size} fields need attention.
          </p>
        )}
        {children}
      </form>
    </FieldErrorsContext>
  );
}

// The error of the field `id` in the surrounding `ValidatedForm`, with the
// attributes that tie it to the field.
export function useFieldError(id: string | undefined, describedBy?: string) {
  const errors = useContext(FieldErrorsContext);
  const error = id ? errors.get(id) : undefined;
  const errorId = id ? `${id}-error` : undefined;
  return {
    error,
    errorId,
    // Without an error the field keeps an `aria-invalid` of its own.
    fieldProps: {
      ...(error ? { "aria-invalid": true as const } : {}),
      "aria-describedby":
        [error ? errorId : undefined, describedBy].filter(Boolean).join(" ") ||
        undefined,
    },
  };
}

export function FieldError({
  id,
  children,
}: {
  id?: string;
  children?: string;
}) {
  if (!children) return null;
  return (
    <p id={id} className="text-xs leading-5 text-destructive">
      {children}
    </p>
  );
}

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: ReactNode;
};

export function FormField({
  label,
  hint,
  id,
  "aria-describedby": describedBy,
  ...props
}: FormFieldProps) {
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
      <Input id={id} {...props} {...fieldProps} />
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

export function FormMessage({
  children,
  tone = "error",
}: {
  children?: string | null;
  tone?: "error" | "success" | "info";
}) {
  if (!children) return null;

  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-lg bg-destructive/8 px-3 py-2.5 text-[13px] leading-5 text-destructive"
          : tone === "success"
            ? "rounded-lg bg-success/10 px-3 py-2.5 text-[13px] leading-5 text-success"
            : "rounded-lg bg-primary/8 px-3 py-2.5 text-[13px] leading-5 text-primary"
      }
    >
      {children}
    </div>
  );
}
