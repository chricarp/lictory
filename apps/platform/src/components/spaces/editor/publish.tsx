import { useEffect, useId, useRef, useState } from "react";
import { GitCommitHorizontal, Send } from "lucide-react";
import type { PageDraftSummary } from "@lictory/core/contracts/protocol";
import { Textarea as TextareaPrimitive } from "@ui-sdk/react/textarea";
import { Button } from "@lictory/ui/button";
import { Popover, usePopover } from "@lictory/ui/popover";
import { MutationRejected } from "@lictory/platform/data/mutations";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type { DraftSession } from "@lictory/platform/components/spaces/editor/session";
import { touchTarget } from "@lictory/platform/components/spaces/touch";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import { suggestReviewer } from "@lictory/platform/components/spaces/history/pull-requests";
import {
  DropdownSelect,
  DropdownSelectOption,
} from "@lictory/ui/dropdown-select";

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
      width={340}
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
  const { mutateConfirmed, userId, directory } = useWorkspace();
  const messageId = useId();
  const reviewerId = useId();
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<
    "idle" | "saving" | "sealing" | "proposing"
  >("idle");
  // A branch exists to be reviewed: while no pull request is open from it,
  // committing can also open one and ask its reviewer, so the person never
  // has to find the pull request form in the page's history.
  const history = usePageHistory(target.pageId);
  const offerReview =
    !target.isMain &&
    !history.pullRequests.some(
      (p) => p.sourceBranchId === target.branchId && p.status !== "merged",
    );
  const [reviewer, setReviewer] = useState<string | null>(null);
  const chosenReviewer =
    reviewer ?? suggestReviewer(history.branches, history.commits, userId);
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

  const submit = async (review: boolean) => {
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
      const sealed = await outcome;
      if (review) {
        setPhase("proposing");
        const pullRequestId = crypto.randomUUID();
        // The message's first line names the change; without one, the page.
        const [firstLine = ""] = message.trim().split("\n");
        const named =
          firstLine.trim().slice(0, 200) ||
          session.doc.getText("title").toJSON().trim() ||
          title;
        try {
          await mutateConfirmed({
            type: "createPagePullRequest",
            pageId: before.pageId,
            pullRequestId,
            sourceBranchId: before.branchId,
            title: named,
          });
          if (chosenReviewer)
            await mutateConfirmed({
              type: "requestPageReview",
              pullRequestId,
              userId: chosenReviewer,
              required: true,
            });
        } catch (e) {
          // The version is committed; only the review is missing. Sending
          // again commits nothing and opens it.
          setError(
            `Committed, but the pull request was not opened${e instanceof Error ? `: ${e.message}` : "."} Send for review again.`,
          );
          return;
        }
      }
      onDone(sealed);
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
        if (phase === "idle") void submit(offerReview);
      }}
    >
      <h2 id={labelId} className="text-sm font-semibold">
        {verb === "Publish" ? "Publish this page" : "Commit to this branch"}
      </h2>
      {(verb === "Publish" || offerReview) && (
        <p className="text-xs text-muted-foreground">
          {verb === "Publish"
            ? "Readers see what is saved now."
            : "Readers see it once approved and merged."}
        </p>
      )}
      <label htmlFor={messageId} className="text-xs font-medium">
        Message <span className="text-muted-foreground">(optional)</span>
      </label>
      <TextareaPrimitive
        id={messageId}
        autoFocus
        rows={2}
        value={message}
        maxLength={500}
        onChange={(e) => setMessage(e.target.value)}
        submitShortcut="mod+enter"
        placeholder="What changed?"
        className="w-full resize-none rounded-md border bg-background px-2 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />
      {offerReview && (
        <>
          <label htmlFor={reviewerId} className="text-xs font-medium">
            Reviewer
          </label>
          <DropdownSelect
            id={reviewerId}
            className="w-full"
            value={chosenReviewer}
            onValueChange={(value) => setReviewer(value)}
          >
            <DropdownSelectOption value="">Ask nobody yet</DropdownSelectOption>
            {directory.members
              .filter((m) => m.id !== userId)
              .map((m) => (
                <DropdownSelectOption key={m.id} value={m.id}>
                  {m.name}
                </DropdownSelectOption>
              ))}
          </DropdownSelect>
        </>
      )}
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
              : phase === "proposing"
                ? "Opening the pull request…"
                : ""}
        </span>
        {offerReview && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={phase !== "idle"}
            onClick={() => void submit(false)}
          >
            Commit only
          </Button>
        )}
        <Button type="submit" size="sm" disabled={phase !== "idle"}>
          {verb === "Publish"
            ? "Publish now"
            : offerReview
              ? "Commit and send for review"
              : "Commit now"}
        </Button>
      </div>
    </form>
  );
}
