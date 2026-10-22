import { useEffect, useId, useState } from "react";
import { Input } from "@lictory/ui/input";
import { authClient } from "@lictory/platform/lib/auth-client";
import {
  normalizeOrganizationHandle,
  organizationHandleError,
  organizationHandleProblem,
  ORGANIZATION_HANDLE_MAX,
} from "@lictory/core/lib/organization-handles";
import { cn } from "@lictory/core/lib/utils";

// Ignore obsolete answers when typing or unmounting. The final write always
// checks uniqueness again; availability is only guidance.
export function useOrganizationHandle(value: string, current?: string) {
  const handle = normalizeOrganizationHandle(value);
  const problem = organizationHandleProblem(handle);
  const unchanged = handle === current;
  const [checked, setChecked] = useState<{
    handle: string;
    available: boolean | null;
    message: string;
  }>();
  useEffect(() => {
    if (problem || unchanged) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void authClient.organization
        .checkSlug({ slug: handle })
        .then((result) => {
          if (active)
            setChecked({
              handle,
              available: !result.error,
              message: result.error
                ? organizationHandleError(result.error)
                : `${handle} is available.`,
            });
        })
        .catch(() => {
          if (active)
            setChecked({
              handle,
              available: null,
              message:
                "Could not check availability. You can try saving the handle.",
            });
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [handle, problem, unchanged]);
  const result = checked?.handle === handle ? checked : undefined;
  const invalid = !!handle && !!problem;
  const taken = !unchanged && result?.available === false;
  return {
    handle,
    blocked: !handle || (!unchanged && (!!problem || !result || taken)),
    invalid: (invalid && !unchanged) || taken,
    message: unchanged
      ? "This is your current organization handle."
      : !handle
        ? "Letters, numbers, hyphens and underscores."
        : (problem ?? result?.message ?? "Checking availability…"),
  };
}

export function OrganizationHandleField({
  value,
  onChange,
  status,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  status: ReturnType<typeof useOrganizationHandle>;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Organization handle
      </label>
      <Input
        id={id}
        name="organizationHandle"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={ORGANIZATION_HANDLE_MAX}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        disabled={disabled}
        aria-invalid={status.invalid || undefined}
        aria-describedby={`${id}-url ${id}-status`}
        placeholder="acme"
      />
      <p id={`${id}-url`} className="text-xs break-all text-muted-foreground">
        Your workspace URL:{" "}
        <span className="font-mono">/app/{status.handle || "your-handle"}</span>
      </p>
      <p
        id={`${id}-status`}
        aria-live="polite"
        className={cn(
          "min-h-5 text-xs",
          status.invalid ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {status.message}
      </p>
    </div>
  );
}
