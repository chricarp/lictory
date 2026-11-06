import { RevisionDiff } from "@lictory/ui/diff";

// Diff signs and tinted rows convey changes; ink text keeps small reading
// text above AA contrast on both the success and destructive backgrounds.
export function DocumentDiff({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  return (
    <RevisionDiff
      before={before}
      after={after}
      className="[&_.text-destructive]:text-foreground [&_.text-success]:text-foreground"
    />
  );
}
