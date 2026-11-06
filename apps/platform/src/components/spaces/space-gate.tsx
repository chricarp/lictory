import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { BookX } from "lucide-react";
import { paths } from "@lictory/core/lib/paths";
import { Button } from "@lictory/ui/button";
import { MissingState } from "@lictory/ui/status-page";
import { LoadingState } from "@lictory/ui/spinner";
import { Link, useParams } from "@lictory/platform/lib/navigation";
import type { Space } from "@lictory/platform/data/spaces";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import {
  useSpaceBySlug,
  useSpaces,
} from "@lictory/platform/components/spaces/store";
import { PageActionsProvider } from "@lictory/platform/components/spaces/page-actions";

// A space that was just created (or just shared with me) reaches this
// browser a moment after the address that names it.
const ARRIVAL_GRACE_MS = 2500;

const SpaceContext = createContext<Space | null>(null);
export function useSpace() {
  const space = useContext(SpaceContext);
  if (!space) throw new Error("useSpace requires a space route.");
  return space;
}

// Resolves `/{org}/spaces/{space}` against the spaces I can read. A space I
// cannot read is indistinguishable from one that does not exist.
export function SpaceGate({ children }: { children: ReactNode }) {
  const { space: slug } = useParams<{ space: string }>();
  const space = useSpaceBySlug(slug);
  const { complete } = useSpaces();
  const [graceFor, setGraceFor] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(() => setGraceFor(slug), ARRIVAL_GRACE_MS);
    return () => clearTimeout(timer);
  }, [slug]);
  const graceOver = graceFor === slug;
  if (!space) {
    if (!complete || !graceOver) return <LoadingState label="Opening space" />;
    return <SpaceNotFound />;
  }
  return (
    <SpaceContext.Provider value={space}>
      <PageActionsProvider space={space}>{children}</PageActionsProvider>
    </SpaceContext.Provider>
  );
}

export function SpaceNotFound() {
  const { organization } = useWorkspace();
  return (
    <MissingState
      illustration="search"
      icon={BookX}
      title="This space was not found"
      action={
        <Link href={paths.spaces(organization.slug)} className="contents">
          <Button variant="secondary">All spaces</Button>
        </Link>
      }
    >
      You may not have access to it, or the address is misspelled.
    </MissingState>
  );
}
