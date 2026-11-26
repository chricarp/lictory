import type { ReactNode } from "react";
import { Popover, type PopoverTriggerProps } from "@lictory/ui/popover";

// The quick reaction set: common answers in a conversation (agree, thanks,
// looking, done, blocked) rather than a full emoji catalog.
export const QUICK_REACTIONS = ["👍", "✅", "👀", "🙏", "🎉", "❤️"] as const;
const PICKER = [
  ...QUICK_REACTIONS,
  "😂",
  "😄",
  "😅",
  "🤔",
  "😮",
  "😢",
  "🔥",
  "🚀",
  "💯",
  "👏",
  "🙌",
  "👌",
  "💡",
  "📌",
  "🐛",
  "⚠️",
  "❌",
  "➕",
] as const;

export function EmojiPicker({
  trigger,
  onPick,
  side = "bottom",
  align = "end",
}: {
  trigger: (props: PopoverTriggerProps) => ReactNode;
  onPick: (emoji: string) => void;
  side?: "bottom" | "top";
  align?: "start" | "end";
}) {
  return (
    <Popover trigger={trigger} width={232} side={side} align={align}>
      {(close) => (
        <div className="grid grid-cols-6 gap-0.5 p-1.5">
          {PICKER.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="grid size-8 place-items-center rounded-md text-lg focus-ring outline-none hover:bg-muted"
              onClick={() => {
                onPick(emoji);
                close();
              }}
            >
              {/* Named by the emoji it shows, after what it does. */}
              <span className="sr-only">React with </span>
              {emoji}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
