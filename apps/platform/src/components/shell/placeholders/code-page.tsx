import { GitPullRequest } from "lucide-react";
import { PlaceholderPage } from "@lictory/platform/components/shell/placeholders/placeholder-page";

// Placeholder until the module ships its own pages.
export function CodePage() {
  return (
    <PlaceholderPage
      title="Code"
      icon={GitPullRequest}
      heading="No code host connected"
    >
      Connect GitHub, GitLab or Bitbucket to see branches, pull requests and
      checks next to the work items they deliver.
    </PlaceholderPage>
  );
}
