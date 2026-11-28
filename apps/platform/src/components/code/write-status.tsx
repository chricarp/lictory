import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { CodeWriteEntity } from "@lictory/core/code/entities";
import { codeWrite } from "@lictory/core/contracts/state-machines";
import { cn } from "@lictory/core/lib/utils";
import { Button } from "@lictory/ui/button";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { message } from "@lictory/platform/components/code/parts";

// A change Lictory is sending to a code host, or one that failed: what it
// does, its state and the host's reason, with retry and cancel where the
// write's state machine allows them.
export function WriteStatus({
  write,
  className,
}: {
  write: CodeWriteEntity;
  className?: string;
}) {
  const { organization, memberName } = useWorkspace();
  const [error, setError] = useState<string>();
  const act = async (name: "retryCodeWrite" | "cancelCodeWrite") => {
    setError(undefined);
    try {
      await callCapability(name, {
        organizationId: organization.id,
        writeId: write.id,
      });
    } catch (e) {
      setError(message(e));
    }
  };
  const failed = write.status === "failed";
  return (
    <div
      role="status"
      className={cn(
        "rounded-md px-2 py-1.5 text-xs",
        failed ? "bg-destructive/8" : "bg-muted",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {failed ? (
          <TriangleAlert
            aria-hidden
            className="size-3.5 shrink-0 text-destructive"
          />
        ) : (
          <Loader2
            aria-hidden
            className="size-3.5 shrink-0 animate-spin text-muted-foreground"
          />
        )}
        <span className="min-w-0 flex-1">
          {write.summary}
          <span className="text-muted-foreground">
            {failed
              ? " failed"
              : write.status === "sending"
                ? " · sending"
                : write.attempts > 0
                  ? " · retrying"
                  : " · queued"}
            {write.performedVia
              ? ` · ${write.performedVia} via ${memberName(write.requestedById)}`
              : ""}
          </span>
        </span>
        {codeWrite.allows(write.status, "retry") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6"
            onClick={() => act("retryCodeWrite")}
          >
            Retry
          </Button>
        )}
        {codeWrite.allows(write.status, "cancel") && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6"
            onClick={() => act("cancelCodeWrite")}
          >
            Cancel
          </Button>
        )}
      </div>
      {write.lastError && (
        <p
          className={cn(
            "mt-1",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {write.lastError}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
