import { useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  GitPullRequest,
} from "lucide-react";
import { Textarea } from "@ui-sdk/react/textarea";
import { callCapability } from "@lictory/core/capabilities/client";
import {
  autonomyLevelMeta,
  type ClaimEntity,
  type DoneCheckResult,
  type DoneEvaluationEntity,
} from "@lictory/core/claims/contracts";
import { cn } from "@lictory/core/lib/utils";
import { paths } from "@lictory/core/lib/paths";
import { relativeTime } from "@lictory/core/lib/work-items";
import { Button } from "@lictory/ui/button";
import { Dialog } from "@lictory/ui/dialog";
import { SectionLabel } from "@lictory/ui/primitives";
import { StatusChip } from "@lictory/ui/status-chip";
import { firstName } from "@lictory/platform/lib/session-state";
import { SessionStateChip } from "@lictory/platform/components/shell/session-chip";
import { ClaimOwner } from "@lictory/platform/components/claims/claim-badge";
import { claimState } from "@lictory/platform/components/claims/claim-state";
import { Link } from "@lictory/platform/lib/navigation";
import { useItem } from "@lictory/platform/components/items/item-context";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  leaseLeft,
  useAgentLabel,
  useAgents,
  useAutonomy,
  useClaimability,
  useLiveClaims,
} from "@lictory/platform/components/claims/claims";

const textareaClass =
  "w-full resize-y rounded-xl border bg-card px-3 py-2 text-[13px] shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/15";

// Who holds the item (an agent acting for a person), what the lease says
// and whether it waits on people; or, unclaimed, whether agents may claim it
// and why not. Native delivery only: external tools own execution.
export function ClaimPanel() {
  const { item, project, userId, canChangeProperties, readOnly } = useItem();
  const { organization, canManage, items, directory, memberName } =
    useWorkspace();
  const claim = useLiveClaims().get(item.id);
  const label = useAgentLabel();
  const verdict = useClaimability()(item);
  const { policy } = useAutonomy(project.id);
  const [releasing, setReleasing] = useState(false);
  if (project.deliveryMode !== "native") return null;
  // Work still being refined belongs to readiness and the delivery scope
  // panel; the factory speaks up once only the scope decision, a blocker or
  // a claim is left.
  if (
    !claim &&
    !verdict.claimable &&
    verdict.stage !== "blocked" &&
    !(verdict.stage === "needs_agreement" && item.refinementState === "ready")
  )
    return null;
  const canRelease =
    !readOnly &&
    (claim?.ownerId === userId || canChangeProperties || canManage(project.id));
  const keyOf = (id: string) => {
    const other = items.find((i) => i.id === id);
    const key = directory.projects.find((p) => p.id === other?.projectId)?.key;
    return other && key ? `${key}-${other.number}` : undefined;
  };
  const owner = claim ? memberName(claim.ownerId) : "";
  const state = claim ? claimState(claim, owner) : null;
  return (
    <section
      aria-label="Agent claim"
      data-rail-section="claim"
      className="scroll-mt-4"
    >
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Factory</SectionLabel>
        <span className="text-xs text-muted-foreground">
          {autonomyLevelMeta[policy.level].label}
        </span>
        <Link
          href={paths.factoryQueue(organization.slug, project.key)}
          className="ml-auto rounded-sm text-xs text-muted-foreground focus-ring outline-none hover:text-foreground"
        >
          Queue
        </Link>
      </div>
      {claim && state ? (
        <div className="space-y-2 text-[13px]">
          {/* One owner line: the agent, the person it acts for and, when
              the item is someone else's, whose work it is. It wraps rather
              than truncating the agent's name. */}
          <ClaimOwnerWithAgent claim={claim} assigneeId={item.assigneeId} />
          <div className="flex flex-wrap items-center gap-2">
            <SessionStateChip state={state} />
            <span className="text-xs text-muted-foreground">
              {claim.sessionWaitingSince
                ? `since ${relativeTime(claim.sessionWaitingSince)}`
                : `claimed ${relativeTime(claim.claimedAt)}`}
            </span>
          </div>
          {claim.sessionWaitingSince && claim.agentSessionId ? (
            <p className="text-xs text-muted-foreground">
              Its session waits on {firstName(owner)}&apos;s answer to an
              approval request.{" "}
              <Link
                href={paths.factorySession(
                  organization.slug,
                  claim.agentSessionId,
                )}
                className="rounded-sm text-foreground underline underline-offset-2 focus-ring outline-none"
              >
                Open the session
              </Link>
            </p>
          ) : claim.state === "waiting" || claim.waitingThreadIds.length ? (
            <p className="text-xs text-muted-foreground">
              Asked{" "}
              {claim.waitingThreadIds.length === 1
                ? "a question"
                : `${claim.waitingThreadIds.length} questions`}{" "}
              about the specification. It resumes when people resolve{" "}
              {claim.waitingThreadIds.length === 1 ? "it" : "them"}.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {claim.state === "starting"
                ? "A session is starting for it."
                : leaseLeft(claim) > 0
                  ? `Lease ends in ${leaseLeft(claim)} min unless the agent renews it.`
                  : "Lease ended; the next sweep returns it to the queue."}
            </p>
          )}
          {claim.lastProgress && (
            <blockquote className="border-l-2 pl-2 text-xs text-foreground/80">
              {claim.lastProgress}
              {claim.lastProgressAt && (
                <span className="block text-muted-foreground">
                  {relativeTime(claim.lastProgressAt)}
                </span>
              )}
            </blockquote>
          )}
          <p className="text-xs text-muted-foreground">
            Done follows from the Definition of Done, never from the
            agent&apos;s report.
          </p>
          {canRelease && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReleasing(true)}
            >
              Release
            </Button>
          )}
        </div>
      ) : verdict.claimable ? (
        <p className="flex items-start gap-1.5 text-[13px]">
          <CircleCheck
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <span>
            Agents can claim this now.
            {policy.level !== "assist" && (
              <span className="text-muted-foreground">
                {" "}
                {autonomyLevelMeta[policy.level].label} dispatches it in rank
                order.
              </span>
            )}
          </span>
        </p>
      ) : (
        <ul className="space-y-1.5">
          {verdict.reasons.map((reason) => (
            <li
              key={reason.code}
              className="flex items-start gap-1.5 text-[13px] leading-5"
            >
              <CircleDashed
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0">
                {reason.message}
                {reason.itemIds?.map((id) => {
                  const key = keyOf(id);
                  return key ? (
                    <Link
                      key={id}
                      href={paths.itemByKey(organization.slug, key)}
                      className="ml-1 text-xs underline underline-offset-2 hover:text-foreground"
                    >
                      Open {key}
                    </Link>
                  ) : null;
                })}
              </span>
            </li>
          ))}
        </ul>
      )}
      {releasing && claim && (
        <ReleaseDialog
          claimId={claim.id}
          agent={label(claim)}
          onClose={() => setReleasing(false)}
        />
      )}
    </section>
  );
}

// The claim's owner line with the agent's avatar (read only for a claimed
// item, so unclaimed items subscribe to nothing more).
function ClaimOwnerWithAgent({
  claim,
  assigneeId,
}: {
  claim: ClaimEntity;
  assigneeId: string | null;
}) {
  const agent = useAgents().get(claim.agentId);
  return (
    <ClaimOwner
      claim={claim}
      agent={agent}
      assigneeId={assigneeId}
      size={20}
      className="flex-wrap text-[13px]"
    />
  );
}

export function ReleaseDialog({
  claimId,
  agent,
  onClose,
}: {
  claimId: string;
  agent: string;
  onClose: () => void;
}) {
  const { organization } = useWorkspace();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const release = async () => {
    setPending(true);
    setError(undefined);
    try {
      await callCapability("releaseClaim", {
        organizationId: organization.id,
        claimId,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The claim was not released.");
      setPending(false);
    }
  };
  return (
    <Dialog
      title="Release this claim?"
      description={`${agent} stops holding the item. It returns to the status it had before the claim, unless someone moved it since. The dispatcher does not start it again until someone retries.`}
      onClose={onClose}
      onSubmit={() => void release()}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Releasing…" : "Release"}
          </Button>
        </>
      }
    >
      <label className="block text-[13px]">
        <span className="font-medium">Note (optional)</span>
        <Textarea
          data-autofocus
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why it is released, for the item's history"
          className={cn("mt-1", textareaClass)}
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </Dialog>
  );
}

const pullRequestStateLabel: Record<"open" | "merged" | "closed", string> = {
  open: "Open",
  merged: "Merged",
  closed: "Closed",
};

// The delivery twin of readiness: what must be true before the item is
// Done, from evidence. Shown while work is in progress or claimed.
export function DefinitionOfDonePanel() {
  const { item, project, entities } = useItem();
  const { organization } = useWorkspace();
  const evaluation = entities.find(
    (e): e is DoneEvaluationEntity =>
      e.type === "doneEvaluation" && e.workItemId === item.id,
  );
  if (project.deliveryMode !== "native" || !evaluation) return null;
  const { checks } = evaluation;
  const passed = checks.filter((c) => c.passed).length;
  return (
    <section
      aria-label="Definition of Done"
      data-rail-section="done"
      className="scroll-mt-4"
    >
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Definition of Done</SectionLabel>
        {checks.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              passed === checks.length
                ? "text-success"
                : "text-muted-foreground",
            )}
          >
            {passed} / {checks.length} checks
          </span>
        )}
      </div>
      {checks.length > 0 && (
        <div aria-hidden className="mb-3 flex gap-1">
          {checks.map((c) => (
            <span
              key={c.key}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                c.passed ? "bg-success" : "bg-foreground/10",
              )}
            />
          ))}
        </div>
      )}
      {checks.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          This project&apos;s Definition of Done has no checks: people move work
          to Done themselves.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {checks.map((check) => (
            <DoneCheckRow
              key={check.key}
              check={check}
              evaluation={evaluation}
            />
          ))}
        </ul>
      )}
      {evaluation.code.pullRequests.length > 0 && (
        <ul className="mt-3 space-y-1">
          {evaluation.code.pullRequests.map((pr) => (
            <li
              key={pr.id}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <GitPullRequest aria-hidden className="size-3.5 shrink-0" />
              {pr.url ? (
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 truncate hover:text-foreground"
                >
                  <span className="truncate">{pr.title}</span>
                  <ExternalLink aria-hidden className="size-3 shrink-0" />
                </a>
              ) : (
                <span className="truncate">{pr.title}</span>
              )}
              <StatusChip
                tone={
                  pr.state === "merged"
                    ? "success"
                    : pr.state === "open"
                      ? "info"
                      : "neutral"
                }
                className="ml-auto"
              >
                {pullRequestStateLabel[pr.state]}
              </StatusChip>
            </li>
          ))}
        </ul>
      )}
      {evaluation.held && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-foreground">
          <CircleAlert
            aria-hidden
            className="mt-px size-3.5 shrink-0 text-warning"
          />
          {evaluation.held}
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {evaluation.passed
          ? "Every check passes."
          : "The item moves to Done by itself when every check passes."}{" "}
        <Link
          href={paths.projectSettings(organization.slug, project.key, "done")}
          className="underline underline-offset-2 hover:text-foreground"
        >
          Definition of Done
        </Link>
      </p>
    </section>
  );
}

function DoneCheckRow({
  check,
  evaluation,
}: {
  check: DoneCheckResult;
  evaluation: DoneEvaluationEntity;
}) {
  const { item, userId, readOnly, memberName, disciplineName, capabilities } =
    useItem();
  const { organization, directory } = useWorkspace();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [overriding, setOverriding] = useState(false);
  const signOff = check.signOff;
  const eligible =
    !!signOff &&
    directory.disciplines.some(
      (d) =>
        d.projectId === item.projectId &&
        !d.archivedAt &&
        d.userIds.includes(userId) &&
        (signOff.disciplineIds.length === 0 ||
          signOff.disciplineIds.includes(d.id)),
    );
  const call = async (name: string, input: Record<string, unknown>) => {
    setPending(true);
    setError(undefined);
    try {
      await callCapability(name, {
        organizationId: organization.id,
        workItemId: item.id,
        checkId: check.key,
        ...input,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The change was not saved.");
    } finally {
      setPending(false);
    }
  };
  return (
    <li className="flex items-start gap-2 text-[13px] leading-5">
      {check.passed ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className={cn(!check.passed && "text-foreground")}>{check.label}</p>
        {!check.passed && check.detail && (
          <p className="text-xs text-muted-foreground">{check.detail}</p>
        )}
        {check.override && (
          <p className="text-xs text-muted-foreground">
            Passed by hand by {memberName(check.override.by)} ·{" "}
            {relativeTime(check.override.at)}: “{check.override.reason}”
          </p>
        )}
        {signOff?.signedOffBy && (
          <p className="text-xs text-muted-foreground">
            Signed off by {memberName(signOff.signedOffBy)}
            {signOff.signedOffAt && ` · ${relativeTime(signOff.signedOffAt)}`}
          </p>
        )}
        {signOff && !signOff.signedOffBy && !eligible && (
          <p className="text-xs text-muted-foreground">
            Signed off by{" "}
            {signOff.disciplineIds.length
              ? signOff.disciplineIds.map(disciplineName).join(" or ")
              : "anyone with a discipline in this project"}
            .
          </p>
        )}
        {!readOnly && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {signOff && eligible && !check.override && (
              <Button
                size="sm"
                variant={signOff.signedOffBy ? "ghost" : "outline"}
                disabled={pending}
                onClick={() =>
                  void call("signOffDoneCheck", {
                    signedOff: !signOff.signedOffBy,
                  })
                }
              >
                {signOff.signedOffBy ? "Withdraw sign-off" : "Sign off"}
              </Button>
            )}
            {capabilities.changeProperties &&
              (check.override ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    void call("overrideDoneCheck", { overridden: false })
                  }
                >
                  Withdraw override
                </Button>
              ) : (
                !check.passed && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setOverriding(true)}
                  >
                    Pass by hand…
                  </Button>
                )
              ))}
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {overriding && (
        <OverrideDialog
          check={check}
          revision={evaluation.revisionId}
          onClose={() => setOverriding(false)}
          onConfirm={async (reason) => {
            await call("overrideDoneCheck", { overridden: true, reason });
            setOverriding(false);
          }}
        />
      )}
    </li>
  );
}

function OverrideDialog({
  check,
  onClose,
  onConfirm,
}: {
  check: DoneCheckResult;
  revision: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      title={`Pass “${check.label}” by hand?`}
      description="An override is recorded with your name and reason in the item's history. It applies to this item's accepted revision only."
      onClose={onClose}
      onSubmit={() => {
        if (reason.trim()) void onConfirm(reason.trim());
      }}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!reason.trim()}>
            Pass by hand
          </Button>
        </>
      }
    >
      <label className="block text-[13px]">
        <span className="font-medium">Reason</span>
        <Textarea
          data-autofocus
          rows={3}
          maxLength={1000}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why this check cannot pass from evidence"
          className={cn("mt-1", textareaClass)}
        />
      </label>
    </Dialog>
  );
}
