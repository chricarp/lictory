import { useState } from "react";
import type { Command } from "@lictory/core/contracts/protocol";
import {
  useCanWrite,
  useWorkspace,
} from "@lictory/platform/components/workspace/provider";
import { Popover } from "@lictory/ui/popover";
import { Button } from "@lictory/ui/button";
import { PeoplePicker } from "@lictory/platform/components/ui/people-picker";
import {
  describeDiscussions,
  discussionTotal,
  type DiscussionCounts,
} from "@lictory/core/spaces/discussion-lifecycle";

export const field =
  "w-full rounded-lg border border-muted-foreground bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
// What deleting a branch or merging a pull request deletes besides itself:
// the discussions of the line that ends, open or resolved, blocking or not
// (docs/internals/spaces.md#when-a-line-ends). `counts` come from the
// server's projection; without them the warning stays general.
export function DiscussionRemovalWarning({
  where,
  counts,
}: {
  where: string;
  counts: DiscussionCounts | undefined;
}) {
  if (counts && !discussionTotal(counts))
    return <p>There are no discussions on {where} to delete.</p>;
  return (
    <p role="note" className="font-medium text-destructive">
      {counts
        ? `This permanently deletes ${describeDiscussions(counts)} on ${where}, with all their replies.`
        : `This permanently deletes every discussion on ${where}, with all their replies.`}{" "}
      Open and resolved, blocking and non-blocking discussions are all deleted.
      This cannot be undone.
    </p>
  );
}
