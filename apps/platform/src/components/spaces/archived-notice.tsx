import { useState } from "react";
import { Archive } from "lucide-react";
import { Button } from "@lictory/ui/button";
import type { Space } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useSpaces } from "@lictory/platform/components/spaces/store";

// Archiving a space is reversible; its administrators restore it here.
export function ArchivedSpaceNotice({ space }: { space: Space }) {
  const { mutateConfirmed } = useWorkspace();
  const { canManageSpace } = useSpaces();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const restore = async () => {
    setPending(true);
    setError(undefined);
    try {
      await mutateConfirmed({
        type: "archiveSpace",
        spaceId: space.id,
        archived: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The space was not restored.");
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-4 rounded-xl bg-warning/8 px-4 py-3 text-[13px] ring-1 ring-warning/25 ring-inset">
      <div className="flex flex-wrap items-center gap-3">
        <Archive className="size-4 shrink-0 text-warning" aria-hidden />
        <p className="min-w-0 flex-1 basis-56">
          <span className="font-medium">This space is archived.</span>{" "}
          <span className="text-muted-foreground">
            Its pages can be read but not changed, and it is hidden from
            navigation.
          </span>
        </p>
        {canManageSpace(space) && (
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => void restore()}
          >
            {pending ? "Restoring…" : "Restore space"}
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
