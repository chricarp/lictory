import { useMemo, useState } from "react";
import type { PageNode } from "@lictory/core/spaces/document/canonical";
import {
  pageMergeResolutionSchema,
  type Command,
} from "@lictory/core/contracts/protocol";
import { markdownToDocument } from "@lictory/core/spaces/document/from-markdown";
import { Button } from "@lictory/ui/button";
import { PageReader } from "@lictory/platform/components/spaces/editor/document";
import { Dialog } from "@lictory/platform/components/spaces/dialog";
import { useMergePreview } from "./preview";
import { ActionError, field, useHistoryAction } from "./shared";

type Resolutions = Extract<Command, { type: "syncPageBranch" }>["resolutions"];
export function ConflictResolution({
  branchId,
  fromBranchId,
  onClose,
}: {
  branchId: string;
  fromBranchId?: string;
  onClose: () => void;
}) {
  const { preview, error, reload } = useMergePreview({
    branchId,
    fromBranchId,
  });
  const action = useHistoryAction();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState("");
  const submit = () => {
    if (!preview) return;
    const resolutions: Resolutions = {};
    try {
      for (const c of preview.conflicts) {
        const choice = choices[c.id];
        if (!choice) return;
        resolutions[c.id] = pageMergeResolutionSchema.parse(
          choice === "manual"
            ? c.kind === "title"
              ? { title: manual[c.id] ?? "" }
              : { manual: markdownToDocument(manual[c.id] ?? "").content ?? [] }
            : choice,
        );
      }
      setParseError("");
      void action.run(
        {
          type: "syncPageBranch",
          branchId,
          fromBranchId: preview.theirs.branchId,
          expectedHead: preview.ours.headCommitId,
          expectedTargetHead: preview.theirs.headCommitId,
          resolutions,
        },
        onClose,
      );
    } catch (e) {
      setParseError(
        e instanceof Error ? e.message : "Check the manual resolution.",
      );
    }
  };
  return (
    <Dialog
      title="Sync branch / resolve conflicts"
      description="Bring the target into your branch. Ours is your branch; theirs is the target. This creates a commit and restarts the live draft."
      width="max-w-3xl"
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => {
              setChoices({});
              setManual({});
              reload();
            }}
          >
            Reload preview
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={
              !preview ||
              preview.alreadyUpToDate ||
              action.pending ||
              preview.conflicts.some((c) => !choices[c.id])
            }
          >
            Sync branch
          </Button>
        </>
      }
    >
      <ActionError error={error || action.error || parseError} />
      {action.error && (
        <p className="text-sm">
          If either head moved, reload the preview and inspect the new changes
          before trying again.
        </p>
      )}
      {!preview && !error && <p role="status">Loading merge preview…</p>}
      {preview?.alreadyUpToDate && (
        <p>Your branch already includes the target version.</p>
      )}
      {preview && !preview.conflicts.length && !preview.alreadyUpToDate && (
        <p>
          No conflicts. Sync {preview.theirs.name} into {preview.ours.name}.
        </p>
      )}
      <div className="space-y-4">
        {preview?.conflicts.map((c, index) => (
          <fieldset
            key={c.id}
            className="min-w-0 space-y-3 rounded-xl border p-3"
          >
            <legend className="px-1 font-medium">
              {c.kind === "title"
                ? "Title conflict"
                : `Content conflict ${index + 1}`}
            </legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {(["base", "ours", "theirs"] as const).map((side) => (
                <section
                  key={side}
                  className="min-w-0 overflow-x-auto rounded-lg bg-muted p-2"
                >
                  <h3 className="mb-2 text-xs font-semibold capitalize">
                    {side}
                  </h3>
                  {c.kind === "title" ? (
                    <p className="text-sm">{c[side]}</p>
                  ) : (
                    <ConflictSide
                      json={c[side].json}
                      label={`${side} conflict content`}
                    />
                  )}
                </section>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {[
                "ours",
                "theirs",
                ...(c.kind === "title" ? [] : ["both"]),
                "manual",
              ].map((choice) => (
                <label key={choice} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    name={c.id}
                    checked={choices[c.id] === choice}
                    onChange={() =>
                      setChoices((v) => ({ ...v, [c.id]: choice }))
                    }
                  />
                  {choice === "manual" ? "Edit manually" : `Use ${choice}`}
                </label>
              ))}
            </div>
            {choices[c.id] === "manual" && (
              <label className="block text-sm">
                {c.kind === "title"
                  ? "Resolved title"
                  : "Resolved content (Markdown converted to page blocks)"}
                <textarea
                  className={`${field} mt-1 min-h-24`}
                  value={manual[c.id] ?? ""}
                  onChange={(e) =>
                    setManual((v) => ({ ...v, [c.id]: e.target.value }))
                  }
                />
              </label>
            )}
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}

// One side of a content conflict. The document object stays the same while
// the preview does, so typing a manual resolution or picking a side does not
// recreate the reader (its editor is rebuilt whenever `content` changes).
function ConflictSide({ json, label }: { json: PageNode[]; label: string }) {
  const content = useMemo(() => ({ type: "doc", content: json }), [json]);
  return <PageReader content={content} label={label} />;
}
