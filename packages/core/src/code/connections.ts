import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import type {
  CodeHostAuthKind,
  CodeHostProviderKind,
} from "@lictory/core/db/code-schema";
import {
  decryptCredential,
  derivedCredentialsKeyInProduction,
  encryptCredential,
} from "@lictory/core/delivery/credentials";
import { DomainError } from "@lictory/core/domain/errors";
import { lock, type Database, type Tx } from "@lictory/core/domain/service";
import type { Environment } from "@lictory/core/lib/env";
import {
  CodeHostError,
  type CodeConnection,
} from "@lictory/core/code/provider";
import {
  codeHostProviders,
  type CodeHostProviders,
} from "@lictory/core/code/registry";
import { writeCodeProjections } from "@lictory/core/code/projections";

// Stored connections: their encrypted credential and webhook secret, the
// adapter for their host, and what happens when a host rejects the
// credential (the connection needs attention; nothing retries with it).

export type ConnectionRow = typeof s.codeConnection.$inferSelect;

export const productName: Record<CodeHostProviderKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
};

// The credential shapes each host and authentication kind accepts.
export function credentialFor(
  provider: CodeHostProviderKind,
  authKind: CodeHostAuthKind,
  raw: Record<string, string | undefined>,
): Record<string, string> {
  const need = (...keys: string[]) => {
    const value: Record<string, string> = {};
    for (const key of keys) {
      const v = raw[key]?.trim();
      if (!v)
        throw new DomainError(
          "validation",
          `Enter the ${key.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`)} for this ${productName[provider]} connection.`,
        );
      value[key] = key === "privateKey" ? (raw[key] ?? "").trim() : v;
    }
    return value;
  };
  if (provider === "github" && authKind === "github_app")
    return need("appId", "privateKey", "installationId");
  if (provider === "bitbucket" && authKind === "oauth_consumer")
    return need("key", "secret");
  if (authKind !== "token")
    throw new DomainError(
      "validation",
      `${productName[provider]} does not connect with ${authKind.replace("_", " ")}.`,
    );
  if (provider === "bitbucket" && raw.email?.trim())
    return need("email", "apiToken");
  return need("token");
}

export function newWebhookSecret() {
  return randomBytes(32).toString("hex");
}

export function createConnections(
  db: Database,
  options: {
    providers?: CodeHostProviders;
    environment?: Environment;
    now?: () => Date;
  } = {},
) {
  const providers = () => options.providers ?? codeHostProviders();
  const now = options.now ?? (() => new Date());

  const open = (row: ConnectionRow) => ({
    provider: providers()[row.provider],
    connection: {
      baseUrl: row.baseUrl,
      authKind: row.authKind,
      credential: decryptCredential(
        row.organizationId,
        row.encryptedCredential,
      ),
    } satisfies CodeConnection,
  });

  const webhookSecret = (row: ConnectionRow) =>
    decryptCredential<string>(row.organizationId, row.encryptedWebhookSecret);

  const row = async (
    tx: Tx | Database,
    organizationId: string,
    connectionId: string,
    includeArchived = false,
  ) => {
    const [found] = await tx
      .select()
      .from(s.codeConnection)
      .where(
        and(
          eq(s.codeConnection.organizationId, organizationId),
          eq(s.codeConnection.id, connectionId),
          includeArchived ? undefined : isNull(s.codeConnection.archivedAt),
        ),
      );
    if (!found)
      throw new DomainError(
        "not_found",
        "The code host connection is unavailable.",
      );
    return found;
  };

  // A rejected credential marks the connection so people see why code
  // stopped updating; other errors are left to their caller.
  const markFailure = async (row: ConnectionRow, error: unknown) => {
    if (!(error instanceof CodeHostError) || error.kind !== "authentication")
      return;
    await db.transaction(async (tx) => {
      await lock(tx, row.organizationId);
      await tx
        .update(s.codeConnection)
        .set({ status: "invalid", lastError: error.message })
        .where(
          and(
            eq(s.codeConnection.organizationId, row.organizationId),
            eq(s.codeConnection.id, row.id),
          ),
        );
      await writeCodeProjections(tx, row.organizationId, {
        connectionIds: [row.id],
      });
    });
  };

  // Production without DELIVERY_CREDENTIALS_KEY: only installations that
  // already stored credentials with the derived key keep doing so (see
  // delivery/credentials.ts).
  const assertCredentialsKey = async (tx: Tx) => {
    if (!derivedCredentialsKeyInProduction(options.environment ?? process.env))
      return;
    const [delivery] = await tx
      .select({ id: s.deliveryConnection.id })
      .from(s.deliveryConnection)
      .limit(1);
    const [code] = await tx
      .select({ id: s.codeConnection.id })
      .from(s.codeConnection)
      .limit(1);
    if (!delivery && !code)
      throw new DomainError(
        "unavailable",
        "Code hosts cannot be connected yet: this Lictory installation has no DELIVERY_CREDENTIALS_KEY. An operator must set it and restart Lictory (see docs/operations/configuration.md).",
      );
  };

  return {
    providers,
    open,
    row,
    webhookSecret,
    markFailure,
    assertCredentialsKey,
    now,
    encrypt: (organizationId: string, value: unknown) =>
      encryptCredential(organizationId, value),
  };
}

export type Connections = ReturnType<typeof createConnections>;
