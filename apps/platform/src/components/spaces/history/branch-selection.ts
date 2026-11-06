import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "@lictory/platform/lib/navigation";
import { usePageHistory } from "@lictory/platform/components/spaces/store";

// The editor and history surfaces share the URL; absent branch means main.
export function usePageBranchSelection() {
  const { page } = useParams<{ page: string }>();
  const { branches } = usePageHistory(page);
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const branchId = search.get("branch");
  const branch = branchId
    ? branches.find((b) => b.id === branchId)
    : branches.find((b) => b.isMain);
  const setBranch = (id: string | null) => {
    const next = new URLSearchParams(search);
    if (id) next.set("branch", id);
    else next.delete("branch");
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  return { branchId: branchId ?? branch?.id ?? null, branch, setBranch };
}
