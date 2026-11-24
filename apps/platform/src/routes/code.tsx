import { CodePage } from "@lictory/platform/components/code/code-page";
import { PullRequestPage } from "@lictory/platform/components/code/pull-request-page";

// /$org/code and /$org/code/pull-requests/$pr: the Code module
// (docs/internals/code-hosts.md). Data comes from Zero; routes load code.
export function CodeRoute() {
  return <CodePage />;
}

export function CodePullRequestRoute() {
  return <PullRequestPage />;
}
