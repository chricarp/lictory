import { useEffect, useId, useRef, useState } from "react";
import { GitCommitHorizontal, Send } from "lucide-react";
import type { PageDraftSummary } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import { MutationRejected } from "@lictory/platform/data/mutations";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type { DraftSession } from "@lictory/platform/components/spaces/editor/session";
import { touchTarget } from "@lictory/platform/components/spaces/touch";

// Publish (main in a Direct space) or Commit (a branch): seals the cut of
// the draft the service has stored. The browser never sends content: it
// waits for "Saved", asks for the stored sequence and names it. The title
// is part of the draft, so the server seals the title stored at that cut;
// the one sent here only stands in for drafts without a working title.
// The answer comes from the page's synchronized history:
// the line's head moves (a new version), or only its committed sequence
// does (edits that cancel out: nothing to publish).

export type PublishTarget = {
  pageId: string;
  branchId: string;
  draft: PageDraftSummary;
  isMain: boolean;
  headCommitId: string | undefined;
};

export type PublishOutcome =
  { kind: "published"; commitId: string } | { kind: "nothing" };

type Watch = {
  headCommitId: string | undefined;
  expectedSequence: number;
  resolve: (outcome: PublishOutcome) => void;
};

export function PublishButton({
  session,
  target,
  title,
  canPublish,
  onOutcome,
}: {
  session: DraftSession;
  target: PublishTarget;
  title: string;
  canPublish: boolean;
  onOutcome: (
    outcome: PublishOutcome | { kind: "error"; message: string },
  ) => void;
}) {
  const verb = target.isMain ? "Publish" : "Commit";
  return (
    <Popover
      width={320}
      align="end"
      disabled={!canPublish}
      trigger={(props) => (
        <Button {...props} size="sm" className={touchTarget}>
          {target.isMain ? (
            <Send className="size-3.5" aria-hidden />
          ) : (
            <GitCommitHorizontal className="size-3.5" aria-hidden />
          )}
          {verb}
        </Button>
      )}
    >
      {(close) => (
        <PublishForm
          session={session}
          target={target}
          title={title}
          verb={verb}
          onDone={(outcome) => {
            close();
            onOutcome(outcome);
          }}
        />
      )}
    </Popover>
  );
}

function PublishForm({
  session,
  target,
  title,
  verb,
  onDone,
}: {
  session: DraftSession;
  target: PublishTarget;
  title: string;
  verb: "Publish" | "Commit";
  onDone: (
    outcome: PublishOutcome | { kind: "error"; message: string },
  ) => void;
}) {
  const labelId = usePopover()?.labelId;
  const { mutateConfirmed } = useWorkspace();
  const messageId = useId();
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "saving" | "sealing">("idle");
  const [error, setError] = useState<string>();
  const watch = useRef<Watch | null>(null);
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
    const pending = watch.current;
    if (!pending) return;
    if (target.headCommitId && target.headCommitId !== pending.headCommitId) {
      watch.current = null;
      pending.resolve({ kind: "published", commitId: target.headCommitId });
    } else if (target.draft.committedSequence >= pending.expectedSequence) {
      watch.current = null;
      pending.resolve({ kind: "nothing" });
    }
  }, [target]);

  const submit = async () => {
    setError(undefined);
    try {
      setPhase("saving");
      await session.saved();
      setPhase("sealing");
      const expectedSequence = await session.latestSequence();
      const before = latest.current;
      const outcome = new Promise<PublishOutcome>((resolve) => {
        watch.current = {
          headCommitId: before.headCommitId,
          expectedSequence,
          resolve,
        };
        // The receipt is confirmed; the history usually follows within
        // moments. If it does not, the line's head decides.
        setTimeout(() => {
          if (watch.current?.resolve !== resolve) return;
          watch.current = null;
          const now = latest.current.headCommitId;
          resolve(
            now && now !== before.headCommitId
              ? { kind: "published", commitId: now }
              : { kind: "nothing" },
          );
        }, 8000);
      });
      try {
        await mutateConfirmed({
          type: "commitDraft",
          pageId: before.pageId,
          branchId: before.branchId,
          draftId: before.draft.id,
          epoch: before.draft.epoch,
          expectedSequence,
          title: session.doc.getText("title").toJSON().trim() || title,
          ...(message.trim() ? { message: message.trim() } : {}),
        });
      } catch (e) {
        watch.current = null;
        if (
          e instanceof MutationRejected &&
          /nothing to commit/i.test(e.message)
        )
          return onDone({ kind: "nothing" });
        throw e;
      }
      onDone(await outcome);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `This page could not be ${verb === "Publish" ? "published" : "committed"}. Try again.`,
      );
    } finally {
      setPhase("idle");
    }
  };

  return (
    <form
      className="flex flex-col gap-2 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (phase === "idle") void submit();
      }}
    >
      <h2 id={labelId} className="text-sm font-semibold">
        {verb === "Publish" ? "Publish this page" : "Commit to this branch"}
      </h2>
      <p className="text-xs text-muted-foreground">
        {verb === "Publish"
          ? "Readers will see what is saved now. Later edits stay unpublished."
          : "Saves what is stored now as a version of this branch."}
      </p>
      <label htmlFor={messageId} className="text-xs font-medium">
        Message <span className="text-muted-foreground">(optional)</span>
      </label>
      <textarea
        id={messageId}
        autoFocus
        rows={2}
        value={message}
        maxLength={500}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
            e.currentTarget.form?.requestSubmit();
        }}
        placeholder="What changed?"
        className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <span
          aria-live="polite"
          className="mr-auto text-xs text-muted-foreground"
        >
          {phase === "saving"
            ? "Waiting for your edits to save…"
            : phase === "sealing"
              ? `${verb === "Publish" ? "Publishing" : "Committing"}…`
              : ""}
        </span>
        <Button type="submit" size="sm" disabled={phase !== "idle"}>
          {verb === "Publish" ? "Publish now" : "Commit now"}
        </Button>
      </div>
    </form>
  );
}
