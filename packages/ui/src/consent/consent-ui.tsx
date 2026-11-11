"use client";

import {
  useConsentManager,
  useFocusTrap,
  useHeadlessConsentUI,
  useTranslations,
} from "@c15t/react/headless";
import { ShieldCheck, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import {
  analyticsConfigured,
  browserAnalyticsSettings,
} from "@lictory/core/lib/analytics/client";
import { cn } from "@lictory/core/lib/utils";

// Consent surfaces are built on c15t's headless hooks so they share the landing
// page's liquid-glass language. They always render in the dark palette: the glass
// tint is tuned for it, and it reads clearly over both light and dark pages.

const glass = cn(
  "dark relative isolate text-foreground",
  "bg-[linear-gradient(180deg,oklch(1_0_0/0.09),oklch(1_0_0/0.03)),linear-gradient(oklch(0.2_0.01_285/0.72),oklch(0.2_0.01_285/0.72))] backdrop-blur-2xl backdrop-saturate-[1.8]",
  "shadow-[inset_0_1px_0_oklch(1_0_0/0.18),inset_0_-1px_0_oklch(1_0_0/0.04),inset_0_0_0_1px_oklch(1_0_0/0.08),0_16px_48px_-12px_oklch(0_0_0/0.6),0_2px_6px_-2px_oklch(0_0_0/0.4)]",
  "before:pointer-events-none before:absolute before:inset-x-8 before:top-0 before:-z-10 before:h-16 before:bg-[radial-gradient(60%_100%_at_50%_0%,oklch(1_0_0/0.1),transparent)]",
);

function GlassButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-9 shrink-0 items-center justify-center rounded-full px-4 text-[13px] font-medium whitespace-nowrap transition-[background-color,color,transform] duration-150 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-white/50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        "bg-white/[0.06] text-foreground shadow-[inset_0_0_0_1px_oklch(1_0_0/0.1)] hover:bg-white/[0.1]",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Reopens the consent dialog, e.g. from footers and account menus. Without
 * analytics settings there is no choice to make, so it renders nothing.
 */
export function PrivacyPreferencesButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  return analyticsConfigured() ? <PreferencesButton {...props} /> : null;
}

function PreferencesButton({
  onClick,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { openDialog } = useHeadlessConsentUI();
  return (
    <button
      type={type}
      onClick={(event) => {
        onClick?.(event);
        openDialog();
      }}
      {...props}
    />
  );
}

/** Without `privacyHref` (no configured notice) the banner links nowhere. */
export function ConsentBanner({ privacyHref }: { privacyHref?: string }) {
  const { banner, performBannerAction, openDialog } = useHeadlessConsentUI();
  const t = useTranslations();
  const [pending, setPending] = useState(false);
  if (!banner.isVisible) return null;

  const act = async (action: "accept" | "reject") => {
    setPending(true);
    try {
      await performBannerAction(action);
    } finally {
      setPending(false);
    }
  };

  return (
    <section
      aria-label={t.cookieBanner.title}
      className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-3 sm:bottom-4"
    >
      <div
        className={cn(
          glass,
          "lictory-enter pointer-events-auto flex w-full max-w-3xl flex-col gap-4 rounded-3xl p-4 sm:flex-row sm:items-center sm:rounded-full sm:py-2 sm:pr-2 sm:pl-5",
        )}
      >
        <div className="flex min-w-0 items-start gap-3 sm:items-center">
          <ShieldCheck
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-foreground/70 sm:mt-0"
          />
          <p className="text-[13px] leading-snug text-foreground/75">
            <span className="font-medium text-foreground">
              {t.cookieBanner.title}.
            </span>{" "}
            {browserAnalyticsSettings()?.consent === "cookieless"
              ? "Visits are counted without cookies. Analytics cookies are optional and need your permission."
              : "Optional analytics cookies need your permission."}
            {privacyHref && (
              <>
                {" "}
                Read the{" "}
                <a
                  href={privacyHref}
                  className="rounded text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                >
                  Privacy Notice
                </a>
                .
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:ml-auto sm:flex-nowrap">
          <GlassButton
            className="px-3 text-foreground/75 shadow-none hover:text-foreground"
            disabled={pending}
            onClick={openDialog}
          >
            {t.common.customize}
          </GlassButton>
          {/* Rejecting must be as easy and as visible as accepting. */}
          <GlassButton disabled={pending} onClick={() => void act("reject")}>
            {t.common.rejectAll}
          </GlassButton>
          <GlassButton disabled={pending} onClick={() => void act("accept")}>
            {t.common.acceptAll}
          </GlassButton>
        </div>
      </div>
    </section>
  );
}

function Switch({
  checked,
  disabled,
  onChange,
  labelledBy,
  describedBy,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  labelledBy: string;
  describedBy: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:cursor-not-allowed disabled:opacity-60",
        checked
          ? "bg-foreground"
          : "bg-white/[0.12] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.08)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-4 rounded-full shadow-sm transition-transform duration-150 ease-out",
          checked ? "translate-x-4 bg-background" : "bg-foreground/80",
        )}
      />
    </button>
  );
}

export function ConsentDialog() {
  const { dialog, closeUI, performDialogAction, saveCustomPreferences } =
    useHeadlessConsentUI();
  const { getDisplayedConsents, selectedConsents, setSelectedConsent } =
    useConsentManager();
  const t = useTranslations();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState(false);
  const open = dialog.isVisible;

  useFocusTrap(open, panelRef);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeUI();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      restoreFocus.current?.focus?.();
    };
  }, [open, closeUI]);

  if (!open) return null;

  const run = async (operation: () => Promise<void>) => {
    setPending(true);
    try {
      await operation();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={closeUI}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={cn(
          glass,
          "lictory-enter flex max-h-[min(36rem,calc(100dvh-1.5rem))] w-full max-w-md flex-col overflow-hidden rounded-3xl",
        )}
      >
        <header className="flex items-start gap-3 px-5 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[15px] font-semibold">
              {t.consentManagerDialog.title}
            </h2>
            <p
              id={descriptionId}
              className="mt-1 text-[13px] leading-snug text-foreground/65"
            >
              Choose which optional data Lictory may collect in this browser.
              You can change this at any time.
            </p>
          </div>
          <button
            type="button"
            aria-label={t.common.close}
            onClick={closeUI}
            className="-mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-foreground/60 transition-colors outline-none hover:bg-white/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-white/50"
          >
            <X className="size-4" />
          </button>
        </header>

        <ul className="mt-4 flex-1 space-y-1.5 overflow-y-auto px-3">
          {getDisplayedConsents().map((consent) => (
            <ConsentRow
              key={consent.name}
              title={t.consentTypes[consent.name]?.title ?? consent.name}
              description={t.consentTypes[consent.name]?.description ?? ""}
              checked={
                consent.disabled
                  ? true
                  : Boolean(selectedConsents[consent.name])
              }
              disabled={(consent.disabled ?? false) || pending}
              locked={consent.disabled}
              onChange={(value) => setSelectedConsent(consent.name, value)}
            />
          ))}
        </ul>

        <footer className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-white/[0.06] px-5 py-4">
          <GlassButton
            disabled={pending}
            onClick={() => void run(() => saveCustomPreferences())}
            className="px-3 text-foreground/75 shadow-none hover:text-foreground"
          >
            {t.common.save}
          </GlassButton>
          <div className="ml-auto flex gap-1.5">
            <GlassButton
              disabled={pending}
              onClick={() => void run(() => performDialogAction("reject"))}
            >
              {t.common.rejectAll}
            </GlassButton>
            <GlassButton
              disabled={pending}
              onClick={() => void run(() => performDialogAction("accept"))}
            >
              {t.common.acceptAll}
            </GlassButton>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ConsentRow({
  title,
  description,
  checked,
  disabled,
  locked,
  onChange,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  locked?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  return (
    <li className="flex items-start gap-4 rounded-2xl bg-white/[0.035] px-3 py-3 shadow-[inset_0_0_0_1px_oklch(1_0_0/0.05)]">
      <div className="min-w-0 flex-1">
        <p id={titleId} className="text-[13px] font-medium">
          {title}
          {locked && (
            <span className="ml-2 text-[11px] font-normal text-foreground/50">
              Always on
            </span>
          )}
        </p>
        <p
          id={descriptionId}
          className="mt-0.5 text-xs leading-snug text-foreground/60"
        >
          {description}
        </p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        labelledBy={titleId}
        describedBy={descriptionId}
      />
    </li>
  );
}
