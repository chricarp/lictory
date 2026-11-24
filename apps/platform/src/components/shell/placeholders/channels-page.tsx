import { Hash } from "lucide-react";
import { PlaceholderPage } from "@lictory/platform/components/shell/placeholders/placeholder-page";

// Placeholder until the module ships its own pages.
export function ChannelsPage() {
  return (
    <PlaceholderPage title="Channels" icon={Hash} heading="No channels yet">
      Channels are where your team and its agents talk. What matters in a
      conversation becomes a proposal, a decision or a discussion on the
      specification.
    </PlaceholderPage>
  );
}
