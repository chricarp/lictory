"use client";
import { useState } from "react";
import {
  Check,
  ChevronDown,
  Plus,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { relativeTime } from "~/lib/work-items";
import type { EntityOf } from "~/sync/shared/protocol";
import { Button } from "~/components/ui/button";
import { Popover, Picker } from "~/components/ui/popover";
import { Avatar, Badge, SectionLabel } from "~/components/ui/primitives";
import { useWorkspace } from "~/components/workspace/provider";
import { useItem } from "~/components/items/item-context";

const responsibilitySuggestions = [
  "Product",
  "Engineering",
  "QA",
  "Architecture",
  "Security",
  "UX",
  "SRE",
];

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
    groupIds,
    mutate,
    base,
    item,
    memberName,
    groupName,
    readOnly,
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
      (a) => a.userId === userId || (a.groupId && groupIds.includes(a.groupId)),
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
                ? "text-emerald-600"
                : "text-muted-foreground",
            )}
          >
            {approved} / {active.length} approved
          </span>
        )}
        {!readOnly && (
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
                    <ShieldCheck className="size-4 text-emerald-600" />
                  ) : review.status === "changes_requested" ? (
                    <ShieldX className="size-4 text-amber-600" />
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
                  {!readOnly && review.status !== "completed" && (
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
                        <Avatar name={memberName(a.userId)} size="xs" />
                      ) : null}
                      {a.userId
                        ? memberName(a.userId)
                        : `${groupName(a.groupId)} (group)`}
                    </span>
                  ))}
                  {granted.map((a) => (
                    <span
                      key={a.id}
                      className="inline-flex items-center gap-1 text-emerald-700"
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
                      className={a.status === "stale" ? "text-amber-700" : ""}
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
  const { directory, userId } = useWorkspace();
  const { mutate, base, reviews, current } = useItem();
  const [responsibility, setResponsibility] = useState("Engineering");
  const [target, setTarget] = useState<string>();
  const [required, setRequired] = useState(true);
  const [error, setError] = useState<string>();
  const options = [
    ...directory.groups.map((g) => ({
      value: `group:${g.id}`,
      label: `${g.name} (group)`,
      hint: `${g.userIds.length} people`,
    })),
    ...directory.members
      .filter((m) => m.id !== userId)
      .map((m) => ({ value: `user:${m.id}`, label: m.name, hint: m.email })),
    ...directory.members
      .filter((m) => m.id === userId)
      .map((m) => ({
        value: `user:${m.id}`,
        label: `${m.name} (me)`,
        hint: m.email,
      })),
  ];
  const selected = options.find((o) => o.value === target);
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
            if (!target) return setError("Choose a reviewer or group.");
            const [type, id] = target.split(":") as ["user" | "group", string];
            try {
              await mutate({
                type: "requestReview",
                ...base,
                reviewId: crypto.randomUUID(),
                responsibility: responsibility.trim(),
                target: { type, id },
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
          <label className="block">
            <span className="text-xs text-muted-foreground">
              Responsibility
            </span>
            <input
              list="responsibilities"
              value={responsibility}
              onChange={(e) => setResponsibility(e.target.value)}
              className="mt-1 h-8 w-full rounded-md border bg-card px-2 text-sm outline-none focus:border-primary/60"
              aria-label="Responsibility"
              required
            />
            <datalist id="responsibilities">
              {responsibilitySuggestions.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            {used.has(responsibility.trim()) && (
              <span className="mt-1 block text-[11px] text-amber-700">
                A {responsibility.trim()} review already exists on this
                revision; another reviewer will be added.
              </span>
            )}
          </label>
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
                  <span className={cn(!selected && "text-muted-foreground")}>
                    {selected?.label ?? "Choose a person or group…"}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </button>
              )}
            >
              <Picker
                title="Reviewer"
                options={options}
                value={target}
                onSelect={setTarget}
              />
            </Popover>
          </div>
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
            <Button type="submit" size="sm">
              Request review
            </Button>
          </div>
        </form>
      )}
    </Popover>
  );
}
