import type { ReactNode } from "react";
import {
  CircleCheck,
  CircleSlash,
  CircleX,
  Clock,
  Hand,
  LoaderCircle,
} from "lucide-react";
import { StatusChip, StatusDot } from "@lictory/ui/status-chip";
import type {
  SessionState,
  StateGlyph,
} from "@lictory/platform/lib/session-state";

const icons: Record<StateGlyph, ReactNode> = {
  queued: <Clock />,
  starting: (
    <LoaderCircle className="animate-spin motion-reduce:animate-none" />
  ),
  running: <StatusDot pulse />,
  waiting: <Hand />,
  completed: <CircleCheck />,
  failed: <CircleX />,
  canceled: <CircleSlash />,
};

// A session's or a claim's state as a chip: `sessionState(...)` decides the
// words and the tone, this draws them.
export function SessionStateChip({
  state,
  className,
}: {
  state: SessionState;
  className?: string;
}) {
  return (
    <StatusChip
      tone={state.tone}
      icon={icons[state.glyph]}
      title={state.meaning}
      className={className}
    >
      {state.label}
    </StatusChip>
  );
}
