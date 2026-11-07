import { useCallback, useEffect, useState } from "react";

// The admin console's client for /api/admin/*. The server authorizes every
// call against the session (instance administrators only); this only turns
// its answers into data or a readable error.

export type SignUpMode = "invite" | "closed" | "open";

export type Overview = {
  policy: {
    signUpMode: SignUpMode;
    allowedEmailDomains: string[];
    organizationCreation: "administrators" | "everyone";
    organizationDeletionGraceDays: number;
  };
  signIn: { password: boolean; sso: string | null };
  email: boolean;
  ai: AiProviderOverview;
  counts: {
    users: number;
    deactivated: number;
    administrators: number;
    organizations: number;
    pendingInvitations: number;
  };
};

// Where Lictory Intelligence sends content (ai/provider-settings.ts
// describeAiProvider); never a key.
export type AiProviderOverview = { dictation: boolean } & (
  | { state: "disabled" | "invalid"; problems: string[] }
  | {
      state: "configured";
      provider: string;
      label: string;
      protocol: string;
      model: string;
      endpoint: string;
      authenticated: boolean;
      keySetting: string | null;
      structuredOutput: "json-schema" | "json-object";
      timeoutSeconds: number;
    }
);

export type AiCheckReport = {
  ok: boolean;
  checks: {
    id: string;
    needs: string;
    ok: boolean;
    ms: number;
    detail: string;
  }[];
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  handle: string | null;
  image: string | null;
  emailVerified: boolean;
  instanceAdmin: boolean;
  twoFactorEnabled: boolean | null;
  deactivatedAt: string | null;
  // Deleted by its owner: an anonymized tombstone the console cannot change.
  deletedAt: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  organizations: { id: string; name: string; slug: string; role: string }[];
};

export type UserPage = {
  users: AdminUser[];
  total: number;
  nextOffset: number | null;
};

export type AdminOrganization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  members: number;
  pendingInvitations: number;
  owners: { id: string; name: string; email: string }[];
  // Scheduled by an owner; the worker deletes it after `deleteAfter`.
  deletion: {
    status: "scheduled" | "deleting";
    deleteAfter: string;
    error: string | null;
  } | null;
};

export type ActivityEvent = {
  id: string;
  action: string;
  label: string;
  via: "web" | "cli";
  actor: { id: string; name: string | null; email: string | null } | null;
  target: { type: string | null; id: string; label: string | null } | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

export type ActivityPage = { events: ActivityEvent[]; before: string | null };

export async function adminRequest<T>(
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    method: init?.method ?? "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body !== undefined && { "Content-Type": "application/json" }),
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await response.json().catch(() => null)) as
    (T & { error?: { message?: string } }) | null;
  if (!response.ok || !body)
    throw new Error(
      body?.error?.message ??
        `The admin console could not reach the server (HTTP ${response.status}).`,
    );
  return body;
}

// Loads a resource and reloads it on demand (after a change).
export function useAdminResource<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    adminRequest<T>(path)
      .then((value) => {
        if (!current) return;
        setData(value);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (current)
          setError(e instanceof Error ? e.message : "Could not load.");
      });
    return () => {
      current = false;
    };
  }, [path, version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, reload };
}

export const signUpModeWords: Record<
  SignUpMode,
  { title: string; detail: string }
> = {
  invite: {
    title: "By invitation",
    detail:
      "People get an account only when an organization invites their email address, or when you create it.",
  },
  closed: {
    title: "Administrators only",
    detail:
      "Only instance administrators create accounts. Invitations reach people who already have one.",
  },
  open: {
    title: "Anyone",
    detail:
      "Anyone who can reach this installation can create an account. Use this only on a private network.",
  },
};

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const date = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
