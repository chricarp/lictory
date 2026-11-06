import { useState } from "react";
import type { Command } from "@lictory/core/contracts/protocol";
import {
  useCanWrite,
  useWorkspace,
} from "@lictory/platform/components/workspace/provider";
import { Popover } from "@lictory/ui/popover";
import { Button } from "@lictory/ui/button";
import { PeoplePicker } from "@lictory/platform/components/ui/people-picker";

export const field =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function useHistoryAction() {
  const { mutateConfirmed } = useWorkspace();
  const online = useCanWrite();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = async (command: Command, done?: () => void) => {
    if (pending || !online) return;
    setPending(true);
    setError("");
    try {
      await mutateConfirmed(command);
      done?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The change failed. Try again.",
      );
    } finally {
      setPending(false);
    }
  };
  return { run, pending: pending || !online, error };
}
export function ActionError({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="my-3 text-sm text-destructive">
      {error}
    </p>
  ) : null;
}
export function ChoosePerson({
  label,
  onSelect,
}: {
  label: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Popover
      width={280}
      trigger={(props) => (
        <Button {...props} size="sm" variant="secondary">
          {label}
        </Button>
      )}
    >
      <PeoplePicker
        title={label}
        onSelect={onSelect}
        memberValue={(m) => m.id}
      />
    </Popover>
  );
}
