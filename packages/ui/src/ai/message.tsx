import type { ComponentProps } from "react";

import { cn } from "@lictory/core/lib/utils";

// Message, Bubble and Marker (shadcn/ui AI Elements, MIT). A message is one
// turn: the person's words in a bubble at the end, the agent's reply at the
// start with its steps and actions. A marker is a line in the transcript that
// is nobody's turn ("Stopped", "Canceled").

export function Message({
  className,
  align = "start",
  ...props
}: ComponentProps<"div"> & { align?: "start" | "end" }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "group/message relative flex w-full min-w-0 gap-3 text-sm data-[align=end]:flex-row-reverse",
        className,
      )}
      {...props}
    />
  );
}

export function MessageAvatar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center self-start",
        className,
      )}
      {...props}
    />
  );
}

export function MessageContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 wrap-break-word group-data-[align=end]/message:items-end",
        className,
      )}
      {...props}
    />
  );
}

export function MessageHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

// Actions under a turn. They follow the message's alignment and stay quiet
// until the turn is hovered or focused, except on the latest reply.
export function MessageFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "-mt-1 flex max-w-full min-w-0 items-center gap-0.5 text-xs text-muted-foreground group-data-[align=end]/message:justify-end",
        className,
      )}
      {...props}
    />
  );
}

const bubbleVariant = {
  default: "bg-primary text-primary-foreground",
  muted: "bg-muted text-foreground",
  outline: "border-border bg-background text-foreground",
  destructive: "bg-destructive/10 text-destructive dark:bg-destructive/20",
};

export function Bubble({
  variant = "muted",
  className,
  ...props
}: ComponentProps<"div"> & { variant?: keyof typeof bubbleVariant }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      className={cn(
        "w-fit max-w-[min(85%,40rem)] min-w-0 overflow-hidden rounded-[1.25rem] border border-transparent px-4 py-2.5 text-[14px] leading-6 wrap-break-word whitespace-pre-wrap group-data-[align=end]/message:self-end group-data-[align=end]/message:rounded-br-md",
        bubbleVariant[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Marker({
  className,
  variant = "default",
  ...props
}: ComponentProps<"div"> & { variant?: "default" | "separator" }) {
  return (
    <div
      data-slot="marker"
      data-variant={variant}
      className={cn(
        "group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-[12.5px] text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
        variant === "separator" &&
          "before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border",
        className,
      )}
      {...props}
    />
  );
}

export function MarkerIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn("grid size-4 shrink-0 place-items-center", className)}
      {...props}
    />
  );
}

export function MarkerContent({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        "min-w-0 wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center",
        className,
      )}
      {...props}
    />
  );
}
