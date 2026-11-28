import { useCallback } from "react";
import type { CodePullRequestEntity } from "@lictory/core/code/entities";
import { paths } from "@lictory/core/lib/paths";
import { Link } from "@lictory/platform/lib/navigation";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import { Actor } from "@lictory/platform/components/identity/actor";
import { useCodeHosts } from "@lictory/platform/components/code/store";
import { providerLabels } from "@lictory/platform/components/code/parts";

type Provider = CodePullRequestEntity["provider"];

// A code host login as the member who linked it (each person links their
// own under Organization settings → Code hosts), or the bare login marked as not
// linked, so "ada" or "reviewer-kai" never reads as if it named a teammate.
export function useLoginMember() {
  const { identities } = useCodeHosts();
  return useCallback(
    (login: string | null | undefined) => {
      if (!login) return null;
      const lower = login.toLowerCase();
      return (
        identities.find((i) => i.login.toLowerCase() === lower)?.userId ?? null
      );
    },
    [identities],
  );
}

export function HostLogin({
  login,
  provider,
  size = 20,
}: {
  login: string | null | undefined;
  provider: Provider;
  size?: 16 | 20;
}) {
  const memberOf = useLoginMember();
  const member = memberOf(login);
  if (member) return <Actor userId={member} size={size} />;
  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      title={`${login ?? "Unknown"} on ${providerLabels[provider]}, not linked to a member`}
    >
      <Actor
        person={{
          id: `login:${login ?? "unknown"}`,
          name: login ?? "Unknown",
        }}
        size={size}
      />
      <span className="text-xs text-muted-foreground">
        ({providerLabels[provider]} login)
      </span>
    </span>
  );
}

// Logins on a page that no member has linked, and how to link them.
export function UnlinkedLogins({
  logins,
  provider,
}: {
  logins: readonly (string | null | undefined)[];
  provider: Provider;
}) {
  const { organization } = useWorkspace();
  const memberOf = useLoginMember();
  const unlinked = [
    ...new Set(logins.filter((l): l is string => !!l && memberOf(l) === null)),
  ];
  if (!unlinked.length) return null;
  const host = providerLabels[provider];
  return (
    <p className="text-xs text-muted-foreground">
      {unlinked.join(", ")}: {host} {unlinked.length === 1 ? "login" : "logins"}{" "}
      not linked to a member. Link yours under{" "}
      <Link
        href={paths.settings(organization.slug, "code")}
        className="underline underline-offset-2 hover:text-foreground"
      >
        Organization settings → Code hosts
      </Link>
      .
    </p>
  );
}
