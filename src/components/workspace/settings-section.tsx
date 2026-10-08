import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// Shared surfaces for settings pages. A group names a context ("Workspace",
// "People & access"); a section is one card inside it with a stable anchor id
// so the page nav can link to it.

export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="px-1">
        <h2 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[13px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

export function SettingsSection({
  id,
  icon,
  title,
  description,
  action,
  children,
  footer,
  className,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(
        "scroll-mt-6 rounded-xl bg-card shadow-(--shadow-border)",
        className,
      )}
    >
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground [&>svg]:size-4">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-title`} className="text-sm font-semibold">
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="flex shrink-0 items-center">{action}</div>}
      </div>
      <div className="border-t border-border">{children}</div>
      {footer && (
        <div className="border-t border-border px-5 py-3 text-xs leading-5 text-muted-foreground">
          {footer}
        </div>
      )}
    </section>
  );
}

// Content padding for sections whose body is a form or free text rather than a
// divided list.
export function SettingsBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

// A stacked list whose rows are separated by hairlines; rows own their padding.
export function SettingsList({
  children,
  empty,
  isEmpty,
}: {
  children: ReactNode;
  empty: ReactNode;
  isEmpty: boolean;
}) {
  if (isEmpty)
    return (
      <div className="px-5 py-6 text-center text-[13px] text-muted-foreground">
        {empty}
      </div>
    );
  return <div className="divide-y divide-border">{children}</div>;
}

// Subheading inside a section body (e.g. "Labels" / "Milestones").
export function SettingsSubheading({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2">
      <h4 className="text-[13px] font-medium">{children}</h4>
      {action}
    </div>
  );
}

export function InlineError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-xs text-destructive">
      {children}
    </p>
  );
}
