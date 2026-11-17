"use client";

import type { ReactNode } from "react";
import {
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  toast,
} from "@ui-sdk/react/toast";
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { buttonClass } from "@lictory/ui/button";
import { cn } from "@lictory/core/lib/utils";

function ToastIcon({ type }: { type: string }) {
  let icon: ReactNode = null;
  if (type === "success") icon = <CircleCheckIcon aria-hidden="true" />;
  if (type === "info") icon = <InfoIcon aria-hidden="true" />;
  if (type === "warning") icon = <TriangleAlertIcon aria-hidden="true" />;
  if (type === "error")
    icon = <OctagonXIcon className="text-destructive" aria-hidden="true" />;
  if (type === "loading")
    icon = (
      <Loader2Icon
        className="animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
    );
  if (!icon) return null;
  return (
    <span className="shrink-0 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4">
      {icon}
    </span>
  );
}

// The stack's layout lives in styles.css (`.toast-region`, `.toast`): it is
// driven by the variables the region and each toast publish.
function Toaster() {
  return (
    <ToastRegion side="bottom" align="end" className="toast-region">
      {(item) => (
        <Toast className="toast group/toast">
          <div className="toast-content flex items-center gap-3 p-4">
            <ToastIcon type={item.type ?? "default"} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <ToastTitle className="text-sm font-medium" />
              <ToastDescription className="text-sm text-muted-foreground" />
            </div>
            <ToastAction
              className={cn(
                buttonClass({ variant: "outline", size: "sm" }),
                "shrink-0",
              )}
            />
            <ToastClose
              aria-label="Close toast"
              className={cn(
                buttonClass({ variant: "ghost", size: "icon" }),
                "relative shrink-0 after:absolute after:-inset-2 after:content-[''] [&_svg]:size-4",
              )}
            >
              <XIcon aria-hidden="true" />
            </ToastClose>
          </div>
        </Toast>
      )}
    </ToastRegion>
  );
}

export { Toaster, toast };
