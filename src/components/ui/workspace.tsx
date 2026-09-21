"use client";
import {
  useRef,
  useState,
  useEffect,
  type ReactNode,
  type FormEvent,
} from "react";
import { Button } from "./button";
import { cn } from "~/lib/utils";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
        tone === "good"
          ? "bg-emerald-500/10 text-emerald-700"
          : tone === "warning"
            ? "bg-amber-500/10 text-amber-800"
            : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
export function Panel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 border-b p-5">
      <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <h2 className="font-medium">{title}</h2>
      <div className="mt-2 text-sm leading-6 text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
export function Field({
  label,
  name,
  value,
  multiline = false,
  required = true,
  children,
  placeholder,
  onChange,
}: {
  label: string;
  name: string;
  value?: string;
  multiline?: boolean;
  required?: boolean;
  children?: ReactNode;
  placeholder?: string;
  onChange?: (value: string) => void;
}) {
  const className =
    "mt-1.5 w-full rounded-lg border bg-card px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <label className="block text-sm font-medium">
      {label}
      {children ? (
        <select
          onChange={(event) => onChange?.(event.target.value)}
          name={name}
          defaultValue={value}
          className={className}
          required={required}
        >
          {children}
        </select>
      ) : multiline ? (
        <textarea
          name={name}
          defaultValue={value}
          rows={5}
          className={className}
          required={required}
          placeholder={placeholder}
        />
      ) : (
        <input
          name={name}
          defaultValue={value}
          className={className}
          required={required}
          placeholder={placeholder}
        />
      )}
    </label>
  );
}
export function ActionForm({
  children,
  submit,
  label,
  onDone,
}: {
  children: ReactNode;
  submit: (data: FormData) => Promise<unknown>;
  label: string;
  onDone?: () => void;
}) {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  async function handle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setError(undefined);
    try {
      await submit(new FormData(form));
      form.reset();
      onDone?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={handle} className="space-y-4">
      {children}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </form>
  );
}
export function Dialog({
  title,
  trigger,
  children,
  variant = "primary",
}: {
  title: string;
  trigger: string;
  variant?: "primary" | "secondary";
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        className="fixed inset-0 m-auto max-h-[85dvh] w-[min(36rem,calc(100%-2rem))] overflow-auto rounded-2xl bg-card p-6 text-foreground shadow-[var(--shadow-panel)] backdrop:bg-black/30"
        aria-label={title}
      >
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button
            variant="ghost"
            aria-label="Close dialog"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </div>
        {children(() => setOpen(false))}
      </dialog>
    </>
  );
}
export function ConfirmButton({
  children,
  action,
  message,
}: {
  children: string;
  action: () => Promise<unknown>;
  message: string;
}) {
  return (
    <Dialog title={message} trigger={children} variant="secondary">
      {(close) => (
        <ActionForm label="Confirm" submit={action} onDone={close}>
          <p className="text-sm text-muted-foreground">
            History is preserved. You can reverse this action.
          </p>
        </ActionForm>
      )}
    </Dialog>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span
      title={name}
      className="inline-grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-secondary-foreground"
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}
