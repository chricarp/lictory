"use client";

import type { EntityType, Note } from "@lictory/contracts";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  CalendarClock,
  Check,
  GitBranch,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  X,
} from "@/components/ui/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";

import {
  RevealItem,
  RevealStagger,
  StatusOrb,
  StreamingText,
} from "@/components/ai/primitives";
import { EntityChip } from "@/components/entities/entity-chip";
import { EntityPicker } from "@/components/entities/entity-picker";
import { AttachmentPreview } from "@/components/notes/attachment-preview";
import { AttachmentTile } from "@/components/notes/attachment-tile";
import { Markdown } from "@/components/notes/markdown";
import { MarkdownEditor } from "@/components/notes/markdown-editor";
import { ProcessingPipeline } from "@/components/notes/processing-pipeline";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useApi } from "@/lib/api";
import {
  ENTITY_META,
  NOTE_STATUS_META,
  ROLE_LABEL,
  entityHref,
  formatEntityTime,
  relativeTime,
} from "@/lib/entities";
import { cn } from "@/lib/utils";

const GROUP_ORDER: EntityType[] = [
  "person",
  "place",
  "time",
  "organization",
  "topic",
];

export function NoteDetail({
  note,
  onChange,
}: {
  note: Note;
  onChange: (note: Note) => void;
}) {
  const api = useApi();
  const router = useRouter();

  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [previewId, setPreviewId] = React.useState<string | null>(null);

  // While not editing the form mirrors the server copy, so a background poll
  // that adds an AI-suggested title shows up immediately. Once editing starts
  // the local draft wins until it is saved or cancelled.
  const [form, setForm] = React.useState({
    source: `${note.title ?? ""}\u0000${note.bodyMarkdown}`,
    title: note.title ?? "",
    body: note.bodyMarkdown,
  });
  const source = `${note.title ?? ""}\u0000${note.bodyMarkdown}`;
  if (!editing && form.source !== source) {
    setForm({ source, title: note.title ?? "", body: note.bodyMarkdown });
  }
  const { title, body } = form;
  const setTitle = React.useCallback(
    (value: string) => setForm((current) => ({ ...current, title: value })),
    [],
  );
  const setBody = React.useCallback(
    (value: string) => setForm((current) => ({ ...current, body: value })),
    [],
  );

  const status = NOTE_STATUS_META[note.status];
  const busy = note.status === "processing" || note.status === "queued";

  const run = async (action: () => Promise<{ note: Note }>) => {
    try {
      const result = await action();
      onChange(result.note);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong",
      );
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { note: updated } = await api.updateNote(note.id, {
        title: title.trim() || null,
        bodyMarkdown: body,
      });
      onChange(updated);
      setEditing(false);
      toast.success("Note updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const grouped = GROUP_ORDER.map((type) => ({
    type,
    items: note.entities.filter(
      (item) => item.entity.type === type && item.status !== "rejected",
    ),
  })).filter((group) => group.items.length > 0);

  const suggestedCount = note.entities.filter(
    (item) => item.status === "suggested",
  ).length;

  // `position` is the order the user attached things in; respect it.
  const attachments = [...note.attachments].sort(
    (a, b) => a.position - b.position,
  );
  const images = attachments.filter((item) => item.kind === "image");
  const others = attachments.filter((item) => item.kind !== "image");
  const previewIndex = previewId
    ? attachments.findIndex((item) => item.id === previewId)
    : -1;
  const times = note.entities.filter(
    (item) => item.entity.type === "time" && item.status !== "rejected",
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0">
        {/* ------------------------------ Header ----------------------------- */}
        <header className="mb-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <StatusOrb state={status.orb} />
            <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-subtle">
              {status.label}
            </span>
            <span className="text-[0.6875rem] text-subtle">
              · captured {relativeTime(note.createdAt)}
            </span>

            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={note.pinned ? "Unpin note" : "Pin note"}
                onClick={() =>
                  void run(() =>
                    api.updateNote(note.id, { pinned: !note.pinned }),
                  )
                }
                className={cn(note.pinned && "text-ember")}
              >
                <Pin className={cn(note.pinned && "fill-current")} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Edit note"
                onClick={() => setEditing((current) => !current)}
              >
                {editing ? <X /> : <Pencil />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh note details"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await api.processNote(note.id);
                    toast.success("Refreshing note details");
                    return result;
                  })
                }
              >
                <RefreshCw className={cn(busy && "animate-spin")} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete note"
                onClick={async () => {
                  await api.deleteNote(note.id);
                  toast.success("Note deleted");
                  router.push("/app/notes");
                }}
                className="hover:text-danger"
              >
                <Trash2 />
              </Button>
            </div>
          </div>

          {editing ? (
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title"
              className="h-12 border-0 bg-transparent px-0 text-2xl font-semibold tracking-tight focus:bg-transparent"
            />
          ) : (
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight text-foreground">
              {note.title ?? "Untitled note"}
            </h1>
          )}
        </header>

        {/* ------------------------------ Summary ---------------------------- */}
        {note.aiSummary && !editing ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 rounded-lg border border-[rgb(var(--ember)/0.25)] bg-[rgb(var(--ember)/0.06)] p-5"
          >
            <p className="mb-1.5 inline-flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ember-bright">
              At a glance
            </p>
            <p className="text-sm leading-relaxed text-foreground">
              <StreamingText text={note.aiSummary} />
            </p>
          </motion.div>
        ) : null}

        {note.aiAnalysis && !editing ? (
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-semibold tracking-tight text-foreground">
              Rundown
            </h2>
            <Markdown className="rounded-lg border border-hairline bg-surface p-5 text-sm">
              {note.aiAnalysis}
            </Markdown>
          </section>
        ) : null}

        {note.status === "failed" && note.aiError ? (
          <div className="mb-5 flex items-start gap-2.5 rounded-md border border-[rgb(var(--danger)/0.3)] bg-[rgb(var(--danger)/0.08)] p-4 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-medium">Couldn’t finish this note</p>
              <p className="mt-0.5 opacity-85">{note.aiError}</p>
            </div>
          </div>
        ) : null}

        {/* ------------------------------- Body ------------------------------ */}
        {editing ? (
          <div className="mb-5">
            <MarkdownEditor value={body} onChange={setBody} minRows={10} />
            <div className="mt-3 flex items-center gap-2">
              <Button
                variant="primary"
                loading={saving}
                onClick={() => void save()}
              >
                <Check />
                Save changes
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : note.bodyMarkdown.trim() ? (
          <Markdown className="mb-6">{note.bodyMarkdown}</Markdown>
        ) : null}

        {/* --------------------------- Attachments --------------------------- */}
        {images.length > 0 ? (
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((attachment) => (
              <AttachmentTile
                key={attachment.id}
                attachment={attachment}
                onPreview={() => setPreviewId(attachment.id)}
                onRemove={
                  editing
                    ? () =>
                        void run(async () => {
                          await api.deleteAttachment(note.id, attachment.id);
                          return api.getNote(note.id);
                        })
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}

        {others.length > 0 ? (
          <div className="mb-5 flex flex-col gap-2">
            {others.map((attachment) => (
              <AttachmentTile
                key={attachment.id}
                attachment={attachment}
                onPreview={() => setPreviewId(attachment.id)}
                onRemove={
                  editing
                    ? () =>
                        void run(async () => {
                          await api.deleteAttachment(note.id, attachment.id);
                          return api.getNote(note.id);
                        })
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}

        {times.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <CalendarClock className="size-3.5 text-subtle" />
              Dates & reminders
              <span className="text-xs font-normal text-subtle">
                {times.length}
              </span>
            </h2>
            <div className="flex flex-col gap-2">
              {times.map((item) => {
                const entity = item.entity;
                const reason =
                  entity.reminderReason ?? entity.description ?? item.mention;
                return (
                  <Link
                    key={entity.id}
                    href={entityHref(entity.id)}
                    className="rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-hairline-strong hover:bg-surface-strong"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-[0.8125rem] font-medium text-foreground">
                          {entity.name}
                        </p>
                        {entity.startsAt ? (
                          <p className="mt-0.5 text-xs text-muted">
                            {formatEntityTime(entity.startsAt, entity.allDay)}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-[0.08em]",
                          entity.needsReminder
                            ? "border-[rgb(var(--ember)/0.35)] bg-[rgb(var(--ember)/0.1)] text-ember-bright"
                            : "border-hairline text-subtle",
                        )}
                      >
                        {entity.needsReminder
                          ? "Reminder suggested"
                          : (entity.timeKind ?? "Date")}
                      </span>
                    </div>
                    {reason ? (
                      <p className="mt-2 text-xs leading-relaxed text-subtle">
                        {reason}
                      </p>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* ------------------------- Related notes --------------------------- */}
        {note.links.length > 0 ? (
          <section className="mt-8">
            <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground">
              <GitBranch className="size-3.5 text-subtle" />
              Connected notes
              <span className="text-xs font-normal text-subtle">
                {note.links.length}
              </span>
            </h2>
            <div className="flex flex-col gap-2">
              {note.links.map((link) => (
                <motion.div
                  key={link.id}
                  layout
                  className="group flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3.5 transition-colors hover:border-hairline-strong hover:bg-surface-strong"
                >
                  <Link
                    href={`/app/notes/${link.note.id}`}
                    className="min-w-0 flex-1"
                  >
                    <p className="truncate text-[0.8125rem] font-medium text-foreground">
                      {link.note.title ?? "Untitled note"}
                    </p>
                    <p className="truncate text-xs text-subtle">
                      {link.reason ?? link.note.excerpt}
                    </p>
                  </Link>

                  {link.status === "suggested" ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Keep connection"
                        onClick={() =>
                          void run(() =>
                            api.updateNoteLink(note.id, link.id, "confirmed"),
                          )
                        }
                        className="hover:text-success"
                      >
                        <Check />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Dismiss connection"
                        onClick={() =>
                          void run(() =>
                            api.updateNoteLink(note.id, link.id, "rejected"),
                          )
                        }
                        className="hover:text-danger"
                      >
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <ArrowRight className="size-3.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </motion.div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {/* ------------------------------ Sidebar ------------------------------ */}
      {/* min-w-0: at mobile the grid collapses to one column, and without this
          the aside's automatic minimum size sizes the track to its widest
          entity chip, pushing the whole page sideways. */}
      <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start">
        <ProcessingPipeline steps={note.steps} status={note.status} />

        <div className="rounded-lg border border-hairline bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-medium uppercase tracking-[0.08em] text-subtle">
              Context
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Add context"
              onClick={() => setPickerOpen(true)}
            >
              <Plus />
            </Button>
          </div>

          {suggestedCount > 0 ? (
            <p className="mb-3 inline-flex items-center gap-1.5 rounded-lg bg-[rgb(var(--ember)/0.1)] px-2.5 py-1.5 text-[0.6875rem] text-ember-bright">
              {suggestedCount} item{suggestedCount === 1 ? "" : "s"} to review
            </p>
          ) : null}

          {grouped.length === 0 ? (
            <p className="text-xs leading-relaxed text-subtle">
              {busy
                ? "People, places and moments will appear here shortly."
                : "Nothing linked yet. Add a person, place or date to make this note findable."}
            </p>
          ) : (
            <div className="flex flex-col gap-3.5">
              <AnimatePresence initial={false}>
                {grouped.map((group) => (
                  <motion.div key={group.type} layout>
                    <p className="mb-1.5 text-[0.6875rem] uppercase tracking-[0.08em] text-subtle">
                      {ENTITY_META[group.type].plural}
                    </p>
                    <RevealStagger className="flex flex-wrap gap-1.5">
                      {group.items.map((item) => (
                        <RevealItem key={item.entity.id}>
                          <EntityChip
                            entity={item.entity}
                            status={item.status}
                            origin={item.origin}
                            size="sm"
                            onConfirm={() =>
                              void run(() =>
                                api.updateNoteEntity(note.id, item.entity.id, {
                                  status: "confirmed",
                                }),
                              )
                            }
                            onReject={() =>
                              void run(() =>
                                api.updateNoteEntity(note.id, item.entity.id, {
                                  status: "rejected",
                                }),
                              )
                            }
                          />
                        </RevealItem>
                      ))}
                    </RevealStagger>
                    {group.items.some((item) => item.mention) ? (
                      <p className="mt-1.5 text-[0.6875rem] italic leading-relaxed text-subtle">
                        {ROLE_LABEL[group.items[0]!.role]} ·{" "}
                        {group.items.find((item) => item.mention)?.mention}
                      </p>
                    ) : null}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        <Separator />

        <p className="px-1 text-[0.6875rem] leading-relaxed text-subtle">
          You can keep or remove anything shown here. Your choices are saved.
        </p>
      </aside>

      <EntityPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSubmit={async (input) => {
          const { note: updated } = await api.attachEntity(note.id, {
            entityId: input.entityId,
            entity: input.entity,
            role: input.role,
            status: "confirmed",
          });
          onChange(updated);
        }}
      />

      <AttachmentPreview
        attachments={attachments}
        index={previewIndex === -1 ? null : previewIndex}
        onIndexChange={(next) => setPreviewId(attachments[next]?.id ?? null)}
        onClose={() => setPreviewId(null)}
      />
    </div>
  );
}
