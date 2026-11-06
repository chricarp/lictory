import { useEffect, useState } from "react";
import { callCapability } from "@lictory/core/capabilities/client";
import type { PageConflict } from "@lictory/core/spaces/history-state";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

export type MergePreview = {
  ours: { branchId: string; name: string; headCommitId: string };
  theirs: { branchId: string; name: string; headCommitId: string };
  baseCommitId: string | null;
  alreadyUpToDate: boolean;
  resultHash: string | null;
  title: string | null;
  markdown: string | null;
  conflicts: PageConflict[];
};
export function useMergePreview(
  input: { pullRequestId?: string; branchId?: string; fromBranchId?: string },
  heads = "",
  enabled = true,
) {
  const { organization } = useWorkspace();
  const [result, setResult] = useState<{
    key: string;
    preview?: MergePreview;
    error?: string;
  }>();
  const [generation, setGeneration] = useState(0);
  const { pullRequestId, branchId, fromBranchId } = input;
  const key = JSON.stringify([
    organization.id,
    pullRequestId,
    branchId,
    fromBranchId,
    heads,
    generation,
  ]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void callCapability<MergePreview>("previewPageMerge", {
      organizationId: organization.id,
      pullRequestId,
      branchId,
      fromBranchId,
    }).then(
      (value) => {
        if (current) setResult({ key, preview: value });
      },
      (e) => {
        if (current)
          setResult({
            key,
            error:
              e instanceof Error ? e.message : "Could not load merge preview.",
          });
      },
    );
    return () => {
      current = false;
    };
  }, [
    key,
    enabled,
    organization.id,
    pullRequestId,
    branchId,
    fromBranchId,
    heads,
    generation,
  ]);
  return {
    preview: result?.key === key ? result.preview : undefined,
    error: result?.key === key ? (result.error ?? "") : "",
    reload: () => setGeneration((g) => g + 1),
  };
}
