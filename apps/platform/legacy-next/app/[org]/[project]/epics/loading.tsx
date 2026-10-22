// Inside SplitView: with no selection the list ignores this; with one it fills
// the detail pane.
import { ItemSkeleton } from "@lictory/ui/skeleton";

export default function Loading() {
  return <ItemSkeleton />;
}
