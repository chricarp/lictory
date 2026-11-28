import { useQuery } from "@rocicorp/zero/react";
import { Hash, Lock, MessagesSquare } from "lucide-react";
import { queries } from "@lictory/zero/queries";
import { paths } from "@lictory/core/lib/paths";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Link } from "@lictory/platform/lib/navigation";
import { useChannels } from "@lictory/platform/components/channels/store";
import { channelLabel } from "@lictory/platform/components/channels/data";

// The other direction of promotion: the conversations a work item was
// promoted from (or recorded a decision or discussion from). Only channels I
// can read reach me, so a private conversation never shows that it
// discussed this item.

type Promotion = {
  readonly id: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly kind: string;
};

const kindLabel: Record<string, string> = {
  proposal: "Promoted from",
  decision: "Decision recorded from",
  discussion: "Discussion opened from",
};

export function ItemConversations({ workItemId }: { workItemId: string }) {
  const { organization, memberName } = useWorkspace();
  const { byId } = useChannels();
  const [rows] = useQuery(
    queries.workItemConversations({
      organizationId: organization.id,
      workItemId,
    }),
  );
  const promotions = rows as readonly Promotion[];
  if (!promotions.length) return null;
  return (
    <section aria-label="Conversations" className="mt-10">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <MessagesSquare className="size-3.5" aria-hidden /> Conversations
      </h2>
      <ul className="space-y-1">
        {promotions.map((p) => {
          const channel = byId.get(p.channelId);
          const name = channel
            ? channelLabel(channel, memberName)
            : "a channel";
          return (
            <li key={p.id} className="text-[13px]">
              <span className="text-muted-foreground">
                {kindLabel[p.kind] ?? "Linked to"}{" "}
              </span>
              <Link
                href={`${paths.channel(organization.slug, p.channelId)}?message=${encodeURIComponent(p.messageId)}`}
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                {channel?.kind === "private" ? (
                  <Lock className="size-3" aria-hidden />
                ) : channel?.kind === "direct" ? null : (
                  <Hash className="size-3" aria-hidden />
                )}
                {name}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
