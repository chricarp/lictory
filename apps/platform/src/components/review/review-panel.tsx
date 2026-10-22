import { useState } from "react";
import {
  Check,
  ChevronDown,
  Plus,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react";
import { cn } from "@lictory/core/lib/utils";
import { relativeTime } from "@lictory/core/lib/work-items";
import type { EntityOf } from "@lictory/core/contracts/protocol";
import { Button } from "@lictory/ui/button";
import { Picker, Popover } from "@lictory/ui/popover";
import { Avatar, Badge, SectionLabel } from "@lictory/ui/primitives";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useItem } from "@lictory/platform/components/items/item-context";

// Reviews live on the item. Each row is one responsibility on the current
// revision; decisions are only offered to assigned reviewers and always name
// the revision they apply to.
export function ReviewPanel() {
  const {
    reviews,
    assignments,
    approvals,
    current,
    userId,
    disciplineIds,
    mutate,
    base,
    item,
    memberName,
    disciplineName,
    readOnly,
    canRequestReviews,
    revisionNumber,
  } = useItem();
  const [historyOpen, setHistoryOpen] = useState(false);
  const active = reviews.filter(
    (r) => r.status !== "cancelled" && r.revisionId === current?.id,
  );
  const approved = active.filter((r) =>
    approvals.some((a) => a.reviewId === r.id && a.status === "granted"),
  ).length;
  const history = approvals
    .filter((a) => a.status !== "granted")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const assigneesOf = (review: EntityOf<"review">) =>
    assignments.filter((a) => a.reviewId === review.id && !a.withdrawnAt);
  const canDecide = (review: EntityOf<"review">) =>
    assigneesOf(review).some(
      (a) =>
        a.userId === userId ||
        (a.disciplineId && disciplineIds.includes(a.disciplineId)),
    );
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <SectionLabel>Review</SectionLabel>
        {active.length > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              approved === active.length
                ? "text-success"
                : "text-muted-foreground",
            )}
          >
            {approved} / {active.length} approved
          </span>
        )}
        {canRequestReviews && (
          <RequestReview
            trigger={(props) => (
              <Button
                {...props}
                variant="ghost"
                size="sm"
                className="-mr-2 ml-auto"
                aria-label="Request review"
              >
                <Plus className="size-3.5" /> Request
              </Button>
            )}
          />
        )}
      </div>
      {active.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          No review requested for revision {current?.number ?? ""}. Ask
          Engineering, QA or others to review when the intent is clear enough.
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((review) => {
            const granted = approvals.filter(
              (a) => a.reviewId === review.id && a.status === "granted",
            );
            const mine = granted.some((a) => a.reviewerId === userId);
            const decide = (
              decision: "approve" | "changes_requested" | "revoke",
            ) =>
              void mutate({
                type: "decideReview",
                ...base,
                reviewId: review.id,
                decision,
              });
            return (
              <li
                key={review.id}
                className="rounded-md border bg-card p-2 text-[13px]"
              >
                <div className="flex items-center gap-2">
                  {review.status === "completed" ? (
                    <ShieldCheck className="size-4 text-success" />
                  ) : review.status === "changes_requested" ? (
                    <ShieldX className="size-4 text-warning" />
                  ) : (
                    <span className="grid size-4 place-items-center rounded-full border border-dashed border-muted-foreground/60" />
                  )}
                  <span className="font-medium">{review.responsibility}</span>
                  {!review.required && <Badge>Optional</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {review.status === "completed"
                      ? "Approved"
                      : review.status === "changes_requested"
                        ? "Changes requested"
                        : "Requested"}
                  </span>
                  {canRequestReviews && review.status !== "completed" && (
                    <button
                      aria-label={`Cancel ${review.responsibility} review`}
                      title="Cancel this review request"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        void mutate({
                          type: "cancelReview",
                          workItemId: item.id,
                          reviewId: review.id,
                        })
                      }
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-6 text-xs text-muted-foreground">
                  {assigneesOf(review).map((a) => (
                    <span key={a.id} className="inline-flex items-center gap-1">
                      {a.userId ? (
                        <Avatar
                          userId={a.userId}
                          name={memberName(a.userId)}
                          size="xs"
                        />
                      ) : null}
                      {a.userId
                        ? memberName(a.userId)
                        : `Anyone in ${disciplineName(a.disciplineId)}`}
                    </span>
                  ))}
                  {granted.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1 text-success"
                    >
                      <Check className="size-3" /> {memberName(a.reviewerId)} ·
                      revision {revisionNumber(a.revisionId)}
                    </span>
                  ))}
                </div>
                {!readOnly && canDecide(review) && (
                  <div className="mt-2 flex flex-wrap gap-1 pl-6">
                    {mine ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => decide("revoke")}
                      >
                        Revoke my approval
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => decide("approve")}>
                          <Check className="size-3.5" /> Approve revision{" "}
                          {current?.number}
                        </Button>
                        {review.status !== "changes_requested" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => decide("changes_requested")}
                          >
                            Request changes
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {history.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3 transition-transform",
                historyOpen && "rotate-180",
              )}
            />
            {history.length} earlier approval{history.length > 1 ? "s" : ""}
          </button>
          {historyOpen && (
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {history.map((a) => {
                const review = reviews.find((r) => r.id === a.reviewId);
                return (
                  <li key={a.id}>
                    {review?.responsibility ?? "Review"} ·{" "}
                    {memberName(a.reviewerId)} approved revision{" "}
                    {revisionNumber(a.revisionId)} ·{" "}
                    <span
                      className={a.status === "stale" ? "text-warning" : ""}
                    >
                      {a.status === "stale"
                        ? `outdated (${a.endReason ?? "specification revised"})`
                        : "revoked"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {current && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Approvals apply to revision {current.number} ·{" "}
          {relativeTime(current.createdAt)}
        </p>
      )}
    </section>
  );
}

export function RequestReview({
  trigger,
}: {
  trigger: Parameters<typeof Popover>[0]["trigger"];
}) {
  const { directory, memberName, userId } = useWorkspace();
  const { mutate, base, reviews, current, item } = useItem();
  // Only the project's disciplines marked as reviewers can be asked.
  const reviewerRoles = directory.disciplines.filter(
    (r) =>
      r.projectId === item.projectId && !r.archivedAt && r.capabilities.review,
  );
  const [roleId, setRoleId] = useState<string | undefined>(
    () =>
      reviewerRoles.find((r) => !r.userIds.includes(userId))?.id ??
      reviewerRoles[0]?.id,
  );
  const [reviewer, setReviewer] = useState<string>("any");
  const [required, setRequired] = useState(true);
  const [error, setError] = useState<string>();
  const role = reviewerRoles.find((r) => r.id === roleId);
  const people = (role?.userIds ?? [])
    .map((id) => directory.members.find((m) => m.id === id))
    .filter((m): m is NonNullable<typeof m> => Boolean(m));
  const used = new Set(
    reviews
      .filter((r) => r.revisionId === current?.id && r.status !== "cancelled")
      .map((r) => r.responsibility),
  );
  return (
    <Popover width={320} align="end" trigger={trigger}>
      {(close) => (
        <form
          className="space-y-3 p-3 text-[13px]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!role) return setError("Choose a reviewing discipline.");
            try {
              await mutate({
                type: "requestReview",
                ...base,
                reviewId: crypto.randomUUID(),
                disciplineId: role.id,
                userId: reviewer === "any" ? null : reviewer,
                required,
              });
              close();
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Could not request review.",
              );
            }
          }}
        >
          <p className="font-medium">
            Request review of revision {current?.number}
          </p>
          {reviewerRoles.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No discipline of this project can be asked to review yet. A
              project administrator can enable “Can be asked to review” on a
              discipline in project settings.
            </p>
          ) : (
            <>
              <div>
                <span className="text-xs text-muted-foreground">
                  Discipline
                </span>
                <Popover
                  width="trigger"
                  trigger={(props) => (
                    <button
                      {...props}
                      type="button"
                      className="mt-1 flex h-8 w-full items-center justify-between rounded-md border bg-card px-2 text-left text-sm hover:bg-muted"
                      aria-label="Reviewing discipline"
                    >
                      <span className={cn(!role && "text-muted-foreground")}>
                        {role?.name ?? "Choose a discipline…"}
                      </span>
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </button>
                  )}
                >
                  {(closeRole) => (
                    <Picker
                      title="Reviewing discipline"
                      hideSearch={reviewerRoles.length < 8}
                      options={reviewerRoles.map((r) => ({
                        value: r.id,
                        label: r.name,
                        hint: `${r.userIds.length} ${r.userIds.length === 1 ? "person" : "people"}`,
                      }))}
                      value={roleId}
                      onSelect={(id) => {
                        setRoleId(id);
                        setReviewer("any");
                        closeRole();
                      }}
                    />
                  )}
                </Popover>
                {role && used.has(role.name) && (
                  <span className="mt-1 block text-[11px] text-warning">
                    A {role.name} review already exists on this revision;
                    another reviewer will be added.
                  </span>
                )}
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Reviewer</span>
                <Popover
                  width="trigger"
                  trigger={(props) => (
                    <button
                      {...props}
                      type="button"
                      className="mt-1 flex h-8 w-full items-center justify-between rounded-md border bg-card px-2 text-left text-sm hover:bg-muted"
                      aria-label="Reviewer"
                    >
                      <span>
                        {reviewer === "any"
                          ? `Anyone in ${role?.name ?? "the discipline"}`
                          : reviewer === userId
                            ? `${memberName(reviewer)} (me)`
                            : memberName(reviewer)}
                      </span>
                      <ChevronDown className="size-3.5 text-muted-foreground" />
                    </button>
                  )}
                >
                  {(closeReviewer) => (
                    <Picker
                      title="Reviewer"
                      hideSearch={people.length < 8}
                      options={[
                        {
                          value: "any",
                          label: `Anyone in ${role?.name ?? "the discipline"}`,
                          hint: people.length
                            ? `${people.length} ${people.length === 1 ? "person" : "people"}`
                            : "No members yet",
                        },
                        ...people.map((m) => ({
                          value: m.id,
                          label: m.id === userId ? `${m.name} (me)` : m.name,
                          hint: m.email,
                          keywords: m.email,
                          icon: (
                            <Avatar image={m.image} name={m.name} size="xs" />
                          ),
                        })),
                      ]}
                      value={reviewer}
                      onSelect={(v) => {
                        setReviewer(v);
                        closeReviewer();
                      }}
                    />
                  )}
                </Popover>
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
            />{" "}
            Required for readiness
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!role}>
              Request review
            </Button>
          </div>
        </form>
      )}
    </Popover>
  );
}
