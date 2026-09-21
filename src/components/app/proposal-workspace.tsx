"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CircleCheck, Circle } from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  ActionForm,
  Avatar,
  Badge,
  ConfirmButton,
  EmptyState,
  Field,
  Panel,
} from "~/components/ui/workspace";
import type { View } from "~/sync/client/engine";
import type { Command, Entity, Scope } from "~/sync/shared/protocol";
import { href, value } from "./workspace-navigation";
type Proposal = Extract<Entity, { type: "proposal" }>;
export function ProposalWorkspace({
  proposal,
  entities,
  scope,
  view,
  userId,
  mutate,
}: {
  proposal: Proposal;
  entities: Entity[];
  scope: Scope;
  view: View;
  userId: string;
  mutate: (command: Command) => Promise<string>;
}) {
  const revisions = entities
    .filter(
      (e): e is Extract<Entity, { type: "revision" }> =>
        e.type === "revision" && e.proposalId === proposal.id,
    )
    .sort((a, b) => b.number - a.number);
  const current = revisions[0];
  const [section, setSection] = useState("specification");
  const [selectedRevision, setSelectedRevision] = useState<string>();
  const selected = revisions.find((r) => r.id === selectedRevision) ?? current;
  const reviews = entities.filter((e) => e.type === "review");
  const threads = entities.filter((e) => e.type === "thread");
  const readiness = entities.find((e) => e.type === "readiness");
  const name = (id: string) =>
    view.directory.members.find((m) => m.id === id)?.name ?? "Former member";
  if (!current)
    return (
      <div className="p-8">
        <EmptyState title="Opening specification…" />
      </div>
    );
  const base = { proposalId: proposal.id, baseRevisionId: current.id };
  return (
    <>
      <header className="space-y-4 border-b px-6 py-5">
        <Link
          href={href(scope)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground"
        >
          <ArrowLeft className="size-3" />
          All proposals
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {proposal.title}
            </h1>
            <div className="mt-3 flex gap-2">
              <Badge>Revision {current.number}</Badge>
              <Badge>
                {proposal.archivedAt
                  ? "Archived"
                  : proposal.status.replaceAll("_", " ")}
              </Badge>
              <Badge
                tone={
                  threads.some((t) => t.blocking && t.status === "open")
                    ? "warning"
                    : "neutral"
                }
              >
                {threads.filter((t) => t.status === "open").length} open
                discussions
              </Badge>
            </div>
          </div>
          <ConfirmButton
            message={
              proposal.archivedAt
                ? "Restore this proposal?"
                : "Archive this proposal?"
            }
            action={() =>
              mutate({
                type: "archiveProposal",
                proposalId: proposal.id,
                archived: !proposal.archivedAt,
              })
            }
          >
            {proposal.archivedAt ? "Restore" : "Archive"}
          </ConfirmButton>
        </div>
      </header>
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0">
          <nav
            aria-label="Proposal sections"
            className="flex gap-1 overflow-x-auto border-b px-4"
          >
            {[
              "specification",
              "history",
              "discussions",
              "suggestions",
              "activity",
            ].map((s) => (
              <button
                key={s}
                onClick={() => setSection(s)}
                aria-current={section === s ? "page" : undefined}
                className={`min-h-11 shrink-0 border-b-2 px-3 text-xs capitalize ${section === s ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground"}`}
              >
                {s}
              </button>
            ))}
          </nav>
          <div className="p-6 lg:p-8">
            {section === "specification" && (
              <SpecificationEditor
                key={proposal.id}
                current={current}
                disabled={Boolean(proposal.archivedAt)}
                save={(title, content, summary, baseRevisionId) =>
                  mutate({
                    type: "updateSpecification",
                    proposalId: proposal.id,
                    baseRevisionId,
                    title,
                    content,
                    summary,
                  })
                }
              />
            )}
            {section === "history" && (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {revisions.map((r) => (
                    <Button
                      variant={r.id === selected?.id ? "primary" : "secondary"}
                      key={r.id}
                      onClick={() => setSelectedRevision(r.id)}
                    >
                      Revision {r.number}
                    </Button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {selected?.changeSummary} ·{" "}
                  {selected && name(selected.authorId)}
                </p>
                <pre className="overflow-auto rounded-lg bg-muted/50 p-4 text-sm whitespace-pre-wrap">
                  {selected?.content}
                </pre>
                {selected && (
                  <TextComparison
                    before={
                      revisions.find((r) => r.number === selected.number - 1)
                        ?.content ?? ""
                    }
                    after={selected.content}
                  />
                )}
              </div>
            )}
            {section === "discussions" && (
              <div className="space-y-6">
                <h2 className="text-lg font-medium">Discussions</h2>
                {threads.length === 0 && (
                  <EmptyState title="No discussions yet">
                    Ask a question about this revision or flag a blocker.
                  </EmptyState>
                )}
                {threads.map((t) => (
                  <section
                    key={t.id}
                    className="space-y-4 rounded-xl border p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge
                        tone={
                          t.blocking && t.status === "open"
                            ? "warning"
                            : "neutral"
                        }
                      >
                        {t.blocking ? "Blocking" : "Discussion"} · {t.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Revision{" "}
                        {revisions.find((r) => r.id === t.revisionId)?.number} ·{" "}
                        {t.anchor?.section ?? "Document"}
                      </span>
                    </div>
                    {entities
                      .filter(
                        (e): e is Extract<Entity, { type: "message" }> =>
                          e.type === "message" && e.threadId === t.id,
                      )
                      .map((m) => (
                        <div key={m.id} className="text-sm">
                          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Avatar name={name(m.authorId)} />
                            {name(m.authorId)}
                          </div>
                          <p className="whitespace-pre-wrap">{m.body}</p>
                        </div>
                      ))}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          void mutate({
                            type: "setThreadState",
                            proposalId: proposal.id,
                            threadId: t.id,
                            resolved: t.status !== "resolved",
                            blocking: t.blocking,
                          })
                        }
                      >
                        {t.status === "resolved" ? "Reopen" : "Resolve"}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          void mutate({
                            type: "setThreadState",
                            proposalId: proposal.id,
                            threadId: t.id,
                            resolved: t.status === "resolved",
                            blocking: !t.blocking,
                          })
                        }
                      >
                        {t.blocking ? "Mark non-blocking" : "Mark blocking"}
                      </Button>
                    </div>
                    <ActionForm
                      label="Reply"
                      submit={(data) =>
                        mutate({
                          type: "replyToThread",
                          proposalId: proposal.id,
                          threadId: t.id,
                          messageId: crypto.randomUUID(),
                          body: value(data, "body"),
                        })
                      }
                    >
                      <Field label="Reply in context" name="body" multiline />
                    </ActionForm>
                  </section>
                ))}
                <Panel
                  title={`Start a discussion on revision ${current.number}`}
                >
                  <ActionForm
                    label="Post discussion"
                    submit={(data) =>
                      mutate({
                        type: "createThread",
                        ...base,
                        threadId: crypto.randomUUID(),
                        body: value(data, "body"),
                        section: value(data, "section"),
                        blocking: data.has("blocking"),
                      })
                    }
                  >
                    <Field
                      label="Section (optional)"
                      name="section"
                      required={false}
                      placeholder="e.g. Acceptance criteria"
                    />
                    <Field label="Comment" name="body" multiline />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="blocking" />
                      Blocks readiness
                    </label>
                  </ActionForm>
                </Panel>
              </div>
            )}
            {section === "suggestions" && (
              <div className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  Suggestions propose a replacement Markdown document. Accepting
                  one creates a new revision.
                </p>
                {entities
                  .filter((e) => e.type === "suggestion")
                  .map((s) => (
                    <section
                      key={s.id}
                      className="space-y-4 rounded-xl border p-4"
                    >
                      <Badge>
                        {s.status} · revision{" "}
                        {revisions.find((r) => r.id === s.revisionId)?.number}
                      </Badge>
                      <p className="text-sm">{s.rationale}</p>
                      <TextComparison
                        before={
                          revisions.find((r) => r.id === s.revisionId)
                            ?.content ?? ""
                        }
                        after={s.replacement}
                      />
                      {s.status === "pending" && (
                        <div className="flex gap-2">
                          <Button
                            disabled={s.revisionId !== current.id}
                            title={
                              s.revisionId !== current.id
                                ? "Create an updated suggestion against the current revision"
                                : undefined
                            }
                            onClick={() =>
                              void mutate({
                                type: "decideSuggestion",
                                ...base,
                                suggestionId: s.id,
                                accept: true,
                              })
                            }
                          >
                            Accept suggestion
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={() =>
                              void mutate({
                                type: "decideSuggestion",
                                ...base,
                                suggestionId: s.id,
                                accept: false,
                              })
                            }
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                    </section>
                  ))}
                <ActionForm
                  label="Propose change"
                  submit={(data) =>
                    mutate({
                      type: "createSuggestion",
                      ...base,
                      replacement: value(data, "replacement"),
                      rationale: value(data, "rationale"),
                    })
                  }
                >
                  <Field label="Why this change?" name="rationale" />
                  <Field
                    label="Proposed specification (Markdown)"
                    name="replacement"
                    value={current.content}
                    multiline
                  />
                </ActionForm>
              </div>
            )}
            {section === "activity" && (
              <ol className="space-y-4">
                {entities
                  .filter((e) => e.type === "activity")
                  .reverse()
                  .map((a) => (
                    <li key={a.id} className="border-l-2 pl-4 text-sm">
                      <p>
                        <span className="font-medium">{name(a.actorId)}</span> ·{" "}
                        {a.action
                          .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "")
                          .replace(/([A-Z])/g, " $1")
                          .toLowerCase()}
                      </p>
                      <time className="text-xs text-muted-foreground">
                        {new Date(a.createdAt).toLocaleString()}
                      </time>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        </div>
        <aside className="border-t bg-muted/15 xl:border-t-0 xl:border-l">
          <Panel title="Readiness">
            {readiness?.type === "readiness" &&
              readiness.checks.map((c) => (
                <div
                  key={c.label}
                  className="flex items-start gap-2 text-xs leading-5"
                >
                  {c.passed ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  {c.label}
                </div>
              ))}
          </Panel>
          <Panel title="Reviews & approvals">
            {reviews.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Request a review when the specification is ready for another
                perspective.
              </p>
            )}
            {reviews.map((r) => {
              const assignments = entities.filter(
                (e): e is Extract<Entity, { type: "assignment" }> =>
                  e.type === "assignment" && e.reviewId === r.id,
              );
              const assigned = assignments.some(
                (a) =>
                  a.userId === userId ||
                  view.directory.groups.some(
                    (g) => g.id === a.groupId && g.userIds.includes(userId),
                  ),
              );
              const approvals = entities.filter(
                (e): e is Extract<Entity, { type: "approval" }> =>
                  e.type === "approval" && e.reviewId === r.id,
              );
              return (
                <div
                  key={r.id}
                  className="space-y-2 rounded-lg border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-medium">{r.responsibility}</h3>
                    <Badge>{r.required ? "Required" : "Optional"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {assignments
                      .map((a) =>
                        a.userId
                          ? name(a.userId)
                          : view.directory.groups.find(
                              (g) => g.id === a.groupId,
                            )?.name,
                      )
                      .join(", ")}{" "}
                    · revision{" "}
                    {revisions.find((v) => v.id === r.revisionId)?.number}
                  </p>
                  <p className="text-xs">
                    {r.status.replaceAll("_", " ")}
                    {r.revisionId !== current.id && " · Review requires update"}
                  </p>
                  {approvals.map((a) => (
                    <p key={a.id} className="text-xs text-muted-foreground">
                      {name(a.reviewerId)}:{" "}
                      {a.status === "stale"
                        ? "approval stale — specification changed"
                        : a.status}
                    </p>
                  ))}
                  {assigned && r.revisionId === current.id && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        className="min-h-9 px-2 text-xs"
                        onClick={() =>
                          void mutate({
                            type: "decideReview",
                            ...base,
                            reviewId: r.id,
                            decision: "approve",
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        className="min-h-9 px-2 text-xs"
                        variant="secondary"
                        onClick={() =>
                          void mutate({
                            type: "decideReview",
                            ...base,
                            reviewId: r.id,
                            decision: "changes_requested",
                          })
                        }
                      >
                        Request changes
                      </Button>
                      {approvals.some(
                        (a) =>
                          a.reviewerId === userId && a.status === "granted",
                      ) && (
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void mutate({
                              type: "decideReview",
                              ...base,
                              reviewId: r.id,
                              decision: "revoke",
                            })
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </Panel>
          <Panel title={`Request review · revision ${current.number}`}>
            <ActionForm
              label="Request review"
              submit={(data) => {
                const target = value(data, "target");
                return mutate({
                  type: "requestReview",
                  ...base,
                  responsibility: value(data, "responsibility"),
                  target: {
                    type: target.startsWith("group:") ? "group" : "user",
                    id: target.slice(target.indexOf(":") + 1),
                  },
                  required: data.has("required"),
                });
              }}
            >
              <Field
                label="Responsibility"
                name="responsibility"
                value="Engineering"
              />
              <Field label="Reviewer" name="target">
                {view.directory.members.map((m) => (
                  <option key={m.id} value={`user:${m.id}`}>
                    {m.name}
                  </option>
                ))}
                {view.directory.groups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name} (group)
                  </option>
                ))}
              </Field>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" name="required" defaultChecked />
                Required for readiness
              </label>
            </ActionForm>
          </Panel>
        </aside>
      </div>
    </>
  );
}
function SpecificationEditor({
  current,
  save,
  disabled,
}: {
  current: Extract<Entity, { type: "revision" }>;
  save: (
    title: string,
    content: string,
    summary: string,
    baseRevisionId: string,
  ) => Promise<string>;
  disabled: boolean;
}) {
  const [base, setBase] = useState(current);
  const [content, setContent] = useState(current.content);
  const [title, setTitle] = useState(current.title);
  const [notice, setNotice] = useState<string>();
  const [observedRevision, setObservedRevision] = useState(current.id);
  if (observedRevision !== current.id) {
    setObservedRevision(current.id);
    if (content === current.content && title === current.title) {
      setBase(current);
      setNotice(`Revision ${current.number} saved.`);
    }
  }

  return (
    <div className="space-y-4">
      {current.id !== base.id && (
        <div className="rounded-lg bg-amber-500/10 p-4 text-sm">
          Revision {current.number} is now current. Your editor still contains
          revision {base.number}.
          <TextComparison before={content} after={current.content} />
          <Button
            variant="ghost"
            onClick={() => {
              setBase(current);
              setContent(current.content);
              setTitle(current.title);
            }}
          >
            Load latest revision
          </Button>
        </div>
      )}
      <ActionForm
        label="Save revision"
        submit={async (data) => {
          await save(title, content, value(data, "summary"), base.id);
          setNotice(
            "Change queued. The review panel updates after the server confirms this revision.",
          );
        }}
      >
        <label className="block text-sm font-medium">
          Specification title
          <input
            disabled={disabled}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="mt-2 w-full rounded-lg border bg-card p-3 text-lg"
          />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          MARKDOWN SPECIFICATION
          <textarea
            disabled={disabled}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            spellCheck
            className="mt-3 min-h-[460px] w-full resize-y rounded-xl border bg-card p-5 font-mono text-sm leading-7 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <Field
          name="summary"
          label="What changed?"
          placeholder="Describe the intent of this revision"
        />
        <p className="text-xs text-muted-foreground">
          Saving creates an immutable revision when the title or content
          changes. Existing approvals require review.
        </p>
      </ActionForm>
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
function TextComparison({ before, after }: { before: string; after: string }) {
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Compare text
      </summary>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Before</p>
          <pre className="overflow-auto bg-red-500/5 p-3 font-mono text-xs leading-6 whitespace-pre-wrap">
            {before || "No previous content"}
          </pre>
        </div>
        <div>
          <p className="mb-2 text-xs text-muted-foreground">After</p>
          <pre className="overflow-auto bg-emerald-500/5 p-3 font-mono text-xs leading-6 whitespace-pre-wrap">
            {after}
          </pre>
        </div>
      </div>
    </details>
  );
}
