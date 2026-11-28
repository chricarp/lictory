import { useId, useMemo, useState } from "react";
import { callCapability } from "@lictory/core/capabilities/client";
import { plainExcerpt } from "@lictory/core/channels/shared";
import { identifier, typeOf } from "@lictory/core/lib/work-items";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { Checkbox } from "@lictory/ui/checkbox";
import { Input } from "@lictory/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lictory/ui/select";
import { toast } from "@lictory/ui/toast";
import { Dialog, Field } from "@lictory/platform/components/spaces/dialog";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { useRouter } from "@lictory/platform/lib/navigation";
import type { MessageRow } from "@lictory/platform/components/channels/data";
import type { PromotionChoice } from "@lictory/platform/components/channels/message";

// Promotion: a message (or its thread) becomes a proposal, a decision or a
// discussion on a specification. The server runs the work item command with
// its own permissions, quotes the message with a link back, and leaves a
// card in the thread; nothing is predicted (decisions are people's acts).

const titles: Record<PromotionChoice, string> = {
  proposal: "Promote to proposal",
  decision: "Record a decision",
  discussion: "Discuss on a specification",
};

export function PromoteDialog({
  kind,
  message,
  channelId,
  onClose,
}: {
  kind: PromotionChoice;
  message: MessageRow;
  channelId: string;
  onClose: () => void;
}) {
  const { organization, projects, items, delivery, capabilitiesIn } =
    useWorkspace();
  const router = useRouter();
  const ids = { title: useId(), body: useId() };
  const firstLine = plainExcerpt(message.body, 240);
  const [title, setTitle] = useState(firstLine);
  const [body, setBody] = useState("");
  const [includeThread, setIncludeThread] = useState(
    message.replyCount > 0 || Boolean(message.threadRootId),
  );
  const [blocking, setBlocking] = useState(false);
  const editable = projects.filter(
    (p) => !p.archivedAt && capabilitiesIn(p.id).editSpecifications,
  );
  const [projectId, setProjectId] = useState(editable[0]?.id ?? "");
  // Specification-backed items for decisions and discussions.
  const specItems = useMemo(
    () =>
      items
        .filter((i) => !i.archivedAt && typeOf(delivery, i).hasSpecification)
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 200),
    [items, delivery],
  );
  const [workItemId, setWorkItemId] = useState("");
  const [error, setError] = useState("");
  // One promotion per dialog: a repeated submit replays the first (a
  // refused one wrote nothing, so a corrected retry is new).
  const [mutationId] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const projectOf = (id: string) => projects.find((p) => p.id === id);
  const submit = async () => {
    if (sending) return;
    setError("");
    setSending(true);
    const source = {
      organizationId: organization.id,
      channelId,
      messageId: message.id,
      includeThread,
      mutationId,
    };
    try {
      const result =
        kind === "proposal"
          ? await callCapability<{ workItemId: string }>(
              "promoteMessageToProposal",
              { ...source, projectId, title: title.trim() },
            )
          : kind === "decision"
            ? await callCapability<{ workItemId: string }>(
                "promoteMessageToDecision",
                {
                  ...source,
                  workItemId,
                  title: title.trim(),
                  ...(body.trim() ? { body: body.trim() } : {}),
                },
              )
            : await callCapability<{ workItemId: string }>(
                "promoteMessageToDiscussion",
                {
                  ...source,
                  workItemId,
                  section: "",
                  blocking,
                  ...(body.trim() ? { note: body.trim() } : {}),
                },
              );
      const item = items.find((i) => i.id === result.workItemId);
      const key = item
        ? identifier(projectOf(item.projectId), item.number)
        : undefined;
      toast({
        title:
          kind === "proposal"
            ? "Proposal created"
            : kind === "decision"
              ? "Decision recorded"
              : "Discussion opened",
        type: "success",
        ...(key
          ? {
              action: {
                label: "Open",
                onAction: () =>
                  router.push(paths.itemByKey(organization.slug, key)),
              },
            }
          : {}),
      });
      onClose();
    } catch (e) {
      setSending(false);
      setError(e instanceof Error ? e.message : "Promotion failed.");
    }
  };
  const ready =
    kind === "proposal"
      ? Boolean(projectId && title.trim())
      : kind === "decision"
        ? Boolean(workItemId && title.trim())
        : Boolean(workItemId);
  return (
    <Dialog
      title={titles[kind]}
      description={
        kind === "decision"
          ? "Recorded on the specification's current revision."
          : undefined
      }
      onClose={onClose}
      onSubmit={() => {
        if (ready) void submit();
      }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || sending}>
            {kind === "proposal"
              ? "Create proposal"
              : kind === "decision"
                ? "Record decision"
                : "Open discussion"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <blockquote className="line-clamp-4 border-l-2 pl-3 text-[13px] text-muted-foreground">
          {plainExcerpt(message.body, 600)}
        </blockquote>
        {kind === "proposal" ? (
          <Field label="Project">
            {editable.length ? (
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger aria-label="Project" className="w-full">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {editable.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                No project lets you create proposals. Ask a project
                administrator for a discipline that edits specifications.
              </p>
            )}
          </Field>
        ) : (
          <Field label="Specification">
            <Select value={workItemId} onValueChange={setWorkItemId}>
              <SelectTrigger aria-label="Specification" className="w-full">
                <SelectValue placeholder="Choose a work item" />
              </SelectTrigger>
              <SelectContent>
                {specItems.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {identifier(projectOf(i.projectId), i.number)} · {i.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {kind !== "discussion" && (
          <Field
            label={kind === "decision" ? "Decision" : "Title"}
            htmlFor={ids.title}
          >
            <Input
              id={ids.title}
              value={title}
              maxLength={240}
              onChange={(e) => setTitle(e.target.value)}
              data-autofocus
            />
          </Field>
        )}
        {kind !== "proposal" && (
          <Field
            label={kind === "decision" ? "Why" : "Your note"}
            htmlFor={ids.body}
            optional
          >
            <textarea
              id={ids.body}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-input bg-card px-3.5 py-2 text-[14px] outline-none focus:border-primary/60 focus:ring-3 focus:ring-primary/10"
            />
          </Field>
        )}
        <div className="flex flex-col gap-2 text-[13px]">
          <label className="flex items-center gap-2">
            <Checkbox
              checked={includeThread}
              onCheckedChange={(checked) => setIncludeThread(checked === true)}
            />
            Quote the whole thread
          </label>
          {kind === "discussion" && (
            <label className="flex items-center gap-2">
              <Checkbox
                checked={blocking}
                onCheckedChange={(checked) => setBlocking(checked === true)}
              />
              Blocks readiness until resolved
            </label>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
