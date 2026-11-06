import { useParams } from "@lictory/platform/lib/navigation";
import { usePageHistory } from "@lictory/platform/components/spaces/store";
import {
  useSelectedBranchId,
  useSelectLine,
} from "@lictory/platform/components/spaces/editor/line";

// The editor and history surfaces share the URL (`?branch=`, absent means
// main); switching lines goes through the editor's `useSelectLine`, which also
// drops a `?commit=` pinned to the previous line.
export function usePageBranchSelection() {
  const { page } = useParams<{ page: string }>();
  const { branches } = usePageHistory(page);
  const branchId = useSelectedBranchId();
  const select = useSelectLine();
  const branch = branchId
    ? branches.find((b) => b.id === branchId)
    : branches.find((b) => b.isMain);
  const setBranch = (id: string | null) =>
    select(id && !branches.find((b) => b.id === id)?.isMain ? id : null);
  return { branchId: branchId ?? branch?.id ?? null, branch, setBranch };
}
