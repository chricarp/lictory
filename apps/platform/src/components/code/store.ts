import { useMemo } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@lictory/zero/queries";
import type {
  CodeConnectionEntity,
  CodeEntity,
  CodeIdentityEntity,
  CodeIssueEntity,
  CodeLinkEntity,
  CodePullRequestEntity,
  CodeRepositoryEntity,
  CodeWriteEntity,
} from "@lictory/core/code/entities";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";

// The Code module as the browser reads it: `code_entity` rows through Zero
// (docs/internals/code-hosts.md#projections). Live: a webhook processed by
// the worker reaches open pages without polling.

const TTL = "5m";

type Row = { readonly data: unknown };
const entities = (rows: readonly Row[]) =>
  rows.map((r) => r.data as CodeEntity);

export function useCodeHosts() {
  const { organization, userId } = useWorkspace();
  const [rows, result] = useQuery(
    queries.codeHosts({ organizationId: organization.id }),
    { ttl: TTL },
  );
  return useMemo(() => {
    const all = entities(rows);
    const connections = all
      .filter((e): e is CodeConnectionEntity => e.type === "codeConnection")
      .sort((a, b) => a.name.localeCompare(b.name));
    const repositories = all
      .filter((e): e is CodeRepositoryEntity => e.type === "codeRepository")
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const identities = all.filter(
      (e): e is CodeIdentityEntity => e.type === "codeIdentity",
    );
    // My logins, for "mine" and "review requested".
    const myLogins = new Set(
      identities
        .filter((i) => i.userId === userId)
        .map((i) => i.login.toLowerCase()),
    );
    return {
      connections,
      repositories,
      identities,
      myLogins,
      complete: result.type === "complete",
    };
  }, [rows, result.type, userId]);
}

export function useCodeList<T extends "codePullRequest" | "codeIssue">(
  type: T,
  facet: "open" | "closed" | "merged",
) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.codeList({
      organizationId: organization.id,
      type,
      facet,
      limit: 500,
    }),
    { ttl: TTL },
  );
  return useMemo(
    () => ({
      rows: entities(rows) as (T extends "codePullRequest"
        ? CodePullRequestEntity
        : CodeIssueEntity)[],
      complete: result.type === "complete",
    }),
    [rows, result.type],
  );
}

export function useCodePullRequest(pullRequestId: string) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.codePullRequest({ organizationId: organization.id, pullRequestId }),
  );
  return {
    pullRequest: rows[0]?.data as CodePullRequestEntity | undefined,
    complete: result.type === "complete",
  };
}

export function useCodeWrites() {
  const { organization } = useWorkspace();
  const [rows] = useQuery(
    queries.codeWrites({ organizationId: organization.id }),
    { ttl: TTL },
  );
  return useMemo(() => entities(rows) as CodeWriteEntity[], [rows]);
}

export function useWorkItemCode(workItemId: string) {
  const { organization } = useWorkspace();
  const [rows, result] = useQuery(
    queries.workItemCode({ organizationId: organization.id, workItemId }),
    { ttl: TTL },
  );
  return useMemo(() => {
    const all = entities(rows);
    return {
      links: all.filter((e): e is CodeLinkEntity => e.type === "codeLink"),
      writes: all.filter((e): e is CodeWriteEntity => e.type === "codeWrite"),
      complete: result.type === "complete",
    };
  }, [rows, result.type]);
}

// The member behind a code host login, when they told Lictory their login
// (Settings → Code hosts), so host-authored work shows the person.
export function useLoginOwner(login: string | null | undefined) {
  const { identities } = useCodeHosts();
  if (!login) return null;
  const lower = login.toLowerCase();
  return (
    identities.find((i) => i.login.toLowerCase() === lower)?.userId ?? null
  );
}

// Open pull requests by the work item they deliver, for board cards and
// backlog rows. Empty until a code host is connected.
export function useOpenPullRequestsByItem() {
  const { rows } = useCodeList("codePullRequest", "open");
  return useMemo(() => {
    const byItem = new Map<string, CodePullRequestEntity[]>();
    for (const pr of rows)
      for (const link of pr.links) {
        const list = byItem.get(link.workItemId) ?? [];
        if (!list.includes(pr)) list.push(pr);
        byItem.set(link.workItemId, list);
      }
    for (const list of byItem.values())
      list.sort((a, b) => b.hostUpdatedAt.localeCompare(a.hostUpdatedAt));
    return byItem;
  }, [rows]);
}
