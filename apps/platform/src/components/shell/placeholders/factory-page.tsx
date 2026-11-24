import { Bot } from "lucide-react";
import { PlaceholderPage } from "@lictory/platform/components/shell/placeholders/placeholder-page";

// Placeholder until the module ships its own pages.
export function FactoryPage() {
  return (
    <PlaceholderPage title="Factory" icon={Bot} heading="No agents yet">
      Agents implement, review and answer questions on runners your team
      controls, each with an accountable owner. Register a runner to start.
    </PlaceholderPage>
  );
}
