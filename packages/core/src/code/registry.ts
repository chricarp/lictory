import { createBitbucketProvider } from "@lictory/core/code/bitbucket/provider";
import { createGitHubProvider } from "@lictory/core/code/github/provider";
import { createGitLabProvider } from "@lictory/core/code/gitlab/provider";
import type {
  CodeHostProvider,
  CodeHostProviderKind,
} from "@lictory/core/code/provider";

// Resolves a connection's host kind to its adapter. Tests pass their own
// registry (see fake-provider.ts) instead of patching this one.
export type CodeHostProviders = Record<CodeHostProviderKind, CodeHostProvider>;

let providers: CodeHostProviders | undefined;

export function codeHostProviders(): CodeHostProviders {
  return (providers ??= {
    github: createGitHubProvider(),
    gitlab: createGitLabProvider(),
    bitbucket: createBitbucketProvider(),
  });
}
