import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";

const focusable =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Keeps Tab and Shift+Tab cycling through a modal surface's controls.
export function keepTabInside(
  event: React.KeyboardEvent,
  container: HTMLElement,
) {
  if (event.key !== "Tab") return;
  const items = [...container.querySelectorAll<HTMLElement>(focusable)].filter(
    (el) => el.offsetParent !== null,
  );
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const firstItem = items[0]!;
  const lastItem = items.at(-1)!;
  const active = document.activeElement;
  if (event.shiftKey && (active === firstItem || active === container)) {
    event.preventDefault();
    lastItem.focus();
  } else if (!event.shiftKey && active === lastItem) {
    event.preventDefault();
    firstItem.focus();
  }
}

// A modal dialog for Spaces flows (WAI-ARIA dialog pattern): focus moves in
// on open (to `[data-autofocus]` or the first control), Tab stays inside,
// Escape closes, and focus returns to whatever opened it. Popovers opened
// from inside are portaled siblings and keep working.
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  onSubmit,
  width = "max-w-lg",
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  // Renders the dialog as a form; Enter in a field submits.
  onSubmit?: () => void;
  width?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const first =
      node?.querySelector<HTMLElement>("[data-autofocus]") ??
      node?.querySelector<HTMLElement>(focusable);
    first?.focus();
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (panel.current) keepTabInside(event, panel.current);
  };
  const body = (
    <>
      <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
          {description && (
            <p
              id={descriptionId}
              className="mt-1 text-[13px] leading-5 text-muted-foreground"
            >
              {description}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
      {footer && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
          {footer}
        </div>
      )}
    </>
  );
  const className = cn(
    "relative flex max-h-full w-full flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-(--shadow-panel)",
    width,
  );
  const shared = {
    role: "dialog",
    "aria-modal": true,
    "aria-labelledby": titleId,
    "aria-describedby": description ? descriptionId : undefined,
    className,
  } as const;
  return createPortal(
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape and Tab bubble from the dialog's controls; the backdrop is not a control.
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-[10vh] pb-4"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      {onSubmit ? (
        <form
          {...shared}
          ref={panel as React.RefObject<HTMLFormElement>}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {body}
        </form>
      ) : (
        <section {...shared} ref={panel}>
          {body}
        </section>
      )}
    </div>,
    document.body,
  );
}

// A labelled field with an optional hint, used across Spaces forms.
export function Field({
  label,
  hint,
  htmlFor,
  children,
  optional,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium">
        {label}
        {optional && (
          <span className="font-normal text-muted-foreground"> (optional)</span>
        )}
      </label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// Native radio buttons drawn as cards: arrow keys move between them and the
// group is named by its legend.
export function RadioCards<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  disabled,
  columns = 2,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; description?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="mb-1.5 text-xs font-medium">{legend}</legend>
      <div
        className={cn(
          "grid gap-2",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-3",
        )}
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer gap-2.5 rounded-lg px-3 py-2 text-[13px] shadow-(--shadow-border) has-focus-visible:ring-2 has-focus-visible:ring-ring/60 has-disabled:cursor-default",
              value === option.value
                ? "bg-primary/6 ring-1 ring-primary/40"
                : "hover:bg-muted/60",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-0.5 accent-primary outline-none"
            />
            <span className="min-w-0">
              <span className="block font-medium">{option.label}</span>
              {option.description && (
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// A short choice between two or three named options, drawn as a segmented
// control (native radios: arrow keys move, the group is named by its
// label), with the chosen option explained underneath.
export function SegmentedChoice<T extends string>({
  label,
  name,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  name: string;
  value: T;
  options: { value: T; label: string; description?: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const chosen = options.find((o) => o.value === value);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span id={labelId} className="text-xs font-medium">
          {label}
        </span>
        <div
          role="radiogroup"
          aria-labelledby={labelId}
          aria-describedby={chosen?.description ? descriptionId : undefined}
          className="inline-flex rounded-full bg-muted p-0.5"
        >
          {options.map((option) => (
            <label
              key={option.value}
              className={cn(
                "relative inline-flex h-7 cursor-pointer items-center rounded-full px-3 text-xs font-medium transition-[background-color,color,box-shadow] duration-150 ease-out has-focus-visible:ring-2 has-focus-visible:ring-ring/60 has-disabled:cursor-default",
                value === option.value
                  ? "bg-card text-foreground shadow-(--shadow-border)"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-default"
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
      {chosen?.description && (
        <p
          id={descriptionId}
          className="text-xs leading-5 text-muted-foreground"
        >
          {chosen.description}
        </p>
      )}
    </div>
  );
}
