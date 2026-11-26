"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";

// Copies `text` and says so on the button itself for a moment ("Copied"),
// where the person is looking; the button keeps its accessible name.
function CopyButton({
  text,
  label,
  iconOnly = false,
  className,
}: {
  text: string;
  // Names what is copied: "Copy the setup".
  label: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const Icon = copied ? Check : Copy;
  return (
    <Button
      size={iconOnly ? "icon" : "sm"}
      variant={iconOnly ? "ghost" : "secondary"}
      aria-label={label}
      className={cn("shrink-0", className)}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Icon className="size-3.5" aria-hidden />
      {!iconOnly && (
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      )}
    </Button>
  );
}

// Commands, configuration or a manifest a person copies into another tool.
// The text sits in its own scroll area under a caption bar that holds Copy,
// so the button never covers a character at any width; the area is a tab
// stop, so long lines scroll from the keyboard too. On phones long lines
// wrap instead.
export function CommandBlock({
  label,
  caption,
  copyLabel,
  children,
  className,
  maxHeight,
}: {
  // Names the region ("Install and register commands").
  label: string;
  // The caption bar's visible text; the label when left out.
  caption?: ReactNode;
  // The Copy button's name; "Copy" + the label by default.
  copyLabel?: string;
  // The exact text that is shown and copied.
  children: string;
  className?: string;
  // Long text (a manifest) scrolls inside the block past this height.
  maxHeight?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-lg bg-muted/60 shadow-(--shadow-border)",
        className,
      )}
    >
      <div className="flex min-h-9 items-center gap-2 border-b py-1 pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {caption ?? label}
        </span>
        <CopyButton
          text={children}
          label={
            copyLabel ??
            `Copy ${label.charAt(0).toLowerCase()}${label.slice(1)}`
          }
        />
      </div>
      <pre
        aria-label={label}
        role="group"
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region needs a tab stop to scroll with arrow keys
        tabIndex={0}
        className={cn(
          // Phones wrap long lines instead of cutting them at the edge, so
          // a person can read what they copy; wider screens keep each line
          // whole and scroll.
          "overflow-auto p-3 font-mono text-[12px] leading-5 whitespace-pre focus-ring-inset outline-none max-sm:[overflow-wrap:anywhere] max-sm:whitespace-pre-wrap",
          maxHeight === "sm" && "max-h-40",
          maxHeight === "md" && "max-h-64",
        )}
      >
        {children}
      </pre>
    </div>
  );
}

// One value a person copies (a webhook URL, a token, an endpoint): shown in
// full, wrapping anywhere at narrow widths rather than running off the card,
// with an icon Copy button beside it.
export function CopyValue({
  label,
  value,
  testId,
  className,
}: {
  // Names the value: "Webhook URL".
  label: string;
  value: string;
  testId?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-1.5", className)}>
      <code
        data-testid={testId}
        className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs leading-4 break-all"
      >
        {value}
      </code>
      <CopyButton
        text={value}
        label={`Copy ${label.charAt(0).toLowerCase()}${label.slice(1)}`}
        iconOnly
      />
    </div>
  );
}
