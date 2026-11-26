import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import { typeLevels } from "@lictory/core/lib/work-items";
import type {
  CodeHostAuthKind,
  CodeHostProviderKind,
  CodeLinkTarget,
  CodeWriteKind,
} from "@lictory/core/db/code-schema";
import { canManageProject, PROTOCOL } from "@lictory/core/contracts/protocol";
import {
  codePullRequest,
  codeWrite as codeWriteMachine,
} from "@lictory/core/contracts/state-machines";
import { DomainError, requireStep } from "@lictory/core/domain/errors";
import {
  applyMutation,
  lock,
  type Actor,
  type Database,
  type Tx,
} from "@lictory/core/domain/service";
import { signalWork } from "@lictory/core/jobs/signal";
import { platformUrl } from "@lictory/core/lib/auth-base-url";
import { branchNameProblem } from "@lictory/core/lib/branch-name";
import type { Environment } from "@lictory/core/lib/env";
import { paths } from "@lictory/core/lib/paths";
import {
  canLinkRepository,
  codeAccess,
  linkedProjectIds,
  requireCodeHostManager,
  requireCodeWorker,
  requireRepositoryLinker,
  type CodeAccess,
} from "@lictory/core/code/access";
import {
  createConnections,
  credentialFor,
  newWebhookSecret,
  productName,
} from "@lictory/core/code/connections";
import {
  codeEntityKey,
  webhookPath,
  type CodeEntity,
  type CodeLinkEntity,
  type CodePullRequestEntity,
  type CodeWriteEntity,
} from "@lictory/core/code/entities";
import { suggestBranchName } from "@lictory/core/code/keys";
import { mergeBlockers } from "@lictory/core/code/merge-rules";
import {
  CodeHostError,
  type CodeMergeMethod,
} from "@lictory/core/code/provider";
import { writeCodeProjections } from "@lictory/core/code/projections";
import { followCodeEvidence } from "@lictory/core/code/follow";
import type { CodeHostProviders } from "@lictory/core/code/registry";
import {
  addLink,
  connectionRepositoryIds,
  recordActivity,
  touchRepositories,
  Touched,
} from "@lictory/core/code/store";

// Commands and reads of the Code module (docs/internals/code-hosts.md).
// Invariants:
// - credentials are entered only by organization administrators in the
//   browser, verified against the host outside any transaction, stored
//   encrypted and never returned;
// - mirrors are the host's: commands never edit them, they queue writes
//   (`code_write`) the worker sends, and the host's answer updates the
//   mirror;
// - links are Lictory's and are history: unlinking is recorded;
// - every command authorizes inside its transaction under the
//   organization lock and writes its projections there.

export type CodeServiceOptions = {
  providers?: CodeHostProviders;
  environment?: Environment;
  now?: () => Date;
  appUrl?: string;
};

type ConnectInput = {
  organizationId: string;
  provider: CodeHostProviderKind;
  authKind: CodeHostAuthKind;
  baseUrl: string;
  name?: string;
  credential: Record<string, string | undefined>;
  // Replace the credential of this connection instead of adding one.
  connectionId?: string;
};

const performedVia = (actor: Actor) =>
  !actor.surface || actor.surface === "web"
    ? null
    : (actor.agentName?.slice(0, 80) ?? actor.surface);

export function createCodeService(
  db: Database,
  options: CodeServiceOptions = {},
) {
  const connections = createConnections(db, options);
  const now = connections.now;
  const appUrl = () => (options.appUrl ?? platformUrl()).replace(/\/$/, "");

  const audit = (
    tx: Tx,
    organizationId: string,
    actorId: string,
    action: string,
    detail: Record<string, unknown>,
  ) =>
    tx
      .insert(s.configurationAudit)
      .values({ organizationId, actorId, action, detail });

  const repositoryRow = async (
    tx: Tx | Database,
    organizationId: string,
    repositoryId: string,
  ) => {
    const [found] = await tx
      .select({ repository: s.codeRepository, connection: s.codeConnection })
      .from(s.codeRepository)
      .innerJoin(
        s.codeConnection,
        and(
          eq(s.codeConnection.organizationId, s.codeRepository.organizationId),
          eq(s.codeConnection.id, s.codeRepository.connectionId),
        ),
      )
      .where(
        and(
          eq(s.codeRepository.organizationId, organizationId),
          eq(s.codeRepository.id, repositoryId),
          isNull(s.codeConnection.archivedAt),
        ),
      );
    if (!found)
      throw new DomainError("not_found", "This repository is unavailable.");
    return found;
  };

  const pullRequestRow = async (
    tx: Tx | Database,
    organizationId: string,
    pullRequestId: string,
  ) => {
    const [found] = await tx
      .select()
      .from(s.codePullRequest)
      .where(
        and(
          eq(s.codePullRequest.organizationId, organizationId),
          eq(s.codePullRequest.id, pullRequestId),
        ),
      );
    if (!found)
      throw new DomainError("not_found", "This pull request is unavailable.");
    return {
      pullRequest: found,
      ...(await repositoryRow(tx, organizationId, found.repositoryId)),
    };
  };

  const itemRow = async (
    tx: Tx,
    organizationId: string,
    workItemId: string,
  ) => {
    const [found] = await tx
      .select({ item: s.workItem, project: s.project })
      .from(s.workItem)
      .innerJoin(
        s.project,
        and(
          eq(s.project.organizationId, s.workItem.organizationId),
          eq(s.project.id, s.workItem.projectId),
        ),
      )
      .where(
        and(
          eq(s.workItem.organizationId, organizationId),
          eq(s.workItem.id, workItemId),
        ),
      );
    if (!found) throw new DomainError("not_found", "This item is unavailable.");
    return found;
  };

  // Queues one write in the caller's transaction. A request repeated with
  // the same idempotency key returns its first write; reusing a key for a
  // different request is a conflict.
  const enqueue = async (
    tx: Tx,
    actor: Actor,
    input: {
      organizationId: string;
      connectionId: string;
      repositoryId: string;
      kind: CodeWriteKind;
      payload: Record<string, unknown>;
      workItemId?: string | null;
      pullRequestId?: string | null;
      idempotencyKey?: string;
      performedVia?: string | null;
    },
    touched: Touched,
  ) => {
    const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID();
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          input.kind,
          input.repositoryId,
          input.workItemId ?? null,
          input.pullRequestId ?? null,
          input.payload,
        ]),
      )
      .digest("hex");
    const [existing] = await tx
      .select()
      .from(s.codeWrite)
      .where(
        and(
          eq(s.codeWrite.organizationId, input.organizationId),
          eq(s.codeWrite.idempotencyKey, idempotencyKey),
        ),
      );
    if (existing) {
      if (
        existing.requestedById !== actor.userId ||
        existing.fingerprint !== fingerprint
      )
        throw new DomainError(
          "conflict",
          "Mutation ID was already used for a different command.",
        );
      return { write: existing, replayed: true };
    }
    const [write] = await tx
      .insert(s.codeWrite)
      .values({
        organizationId: input.organizationId,
        connectionId: input.connectionId,
        repositoryId: input.repositoryId,
        kind: input.kind,
        payload: input.payload,
        workItemId: input.workItemId ?? null,
        pullRequestId: input.pullRequestId ?? null,
        requestedById: actor.userId,
        performedVia: input.performedVia ?? performedVia(actor),
        agentId: actor.agentScope?.id ?? null,
        agentSessionId:
          actor.agentSessionId ?? actor.agentScope?.sessionId ?? null,
        idempotencyKey,
        fingerprint,
        nextAttemptAt: now(),
      })
      .returning();
    touched.writeIds.add(write!.id);
    if (write!.workItemId) touched.workItemIds.add(write!.workItemId);
    await signalWork(tx, "code");
    return { write: write!, replayed: false };
  };

  const writeView = (write: typeof s.codeWrite.$inferSelect) => ({
    writeId: write.id,
    kind: write.kind,
    status: write.status,
    lastError: write.lastError,
    result: write.result,
  });

  // The person (or agent acting for them) as they sign what Lictory posts.
  const signature = async (tx: Tx, actor: Actor) => {
    const [person] = await tx
      .select({ name: s.user.name })
      .from(s.user)
      .where(eq(s.user.id, actor.userId));
    const name = person?.name ?? "A Lictory member";
    const agent = performedVia(actor);
    return agent ? `${agent} via ${name}` : name;
  };

  const readEntities = async (
    tx: Tx | Database,
    organizationId: string,
    where: ReturnType<typeof and>,
    limit = 200,
  ) =>
    (
      await tx
        .select({ data: s.codeEntity.data })
        .from(s.codeEntity)
        .where(and(eq(s.codeEntity.organizationId, organizationId), where))
        .orderBy(desc(s.codeEntity.updatedAt))
        .limit(limit)
    ).map((r) => r.data as unknown as CodeEntity);

  const member = async (userId: string, organizationId: string) =>
    db.transaction((tx) => codeAccess(tx, userId, organizationId));

  return {
    connections,

    // ------------------------------------------------------- connections

    async connect(actor: Actor, input: ConnectInput) {
      const { organizationId } = input;
      const provider = connections.providers()[input.provider];
      if (!provider.authKinds.includes(input.authKind))
        throw new DomainError(
          "validation",
          `${productName[input.provider]} connects with ${provider.authKinds.join(" or ").replaceAll("_", " ")}.`,
        );
      const credential = credentialFor(
        input.provider,
        input.authKind,
        input.credential,
      );
      const replaced = await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireCodeHostManager(
          await codeAccess(tx, actor.userId, organizationId),
        );
        await connections.assertCredentialsKey(tx);
        return input.connectionId
          ? connections.row(tx, organizationId, input.connectionId)
          : undefined;
      });
      if (replaced && replaced.provider !== input.provider)
        throw new DomainError(
          "validation",
          "A connection keeps its host. Add a new connection for another host.",
        );
      const baseUrl =
        replaced?.baseUrl ?? provider.normalizeBaseUrl(input.baseUrl);
      // Network outside the lock.
      let accountLabel: string;
      try {
        ({ accountLabel } = await provider.verify({
          baseUrl,
          authKind: input.authKind,
          credential,
        }));
      } catch (error) {
        throw error instanceof CodeHostError
          ? connectError(error, productName[input.provider], baseUrl, {
              authKind: input.authKind,
            })
          : error;
      }
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireCodeHostManager(
          await codeAccess(tx, actor.userId, organizationId),
        );
        const encryptedCredential = connections.encrypt(
          organizationId,
          credential,
        );
        const touched = new Touched();
        let id: string;
        let secret: string | undefined;
        if (replaced) {
          await tx
            .update(s.codeConnection)
            .set({
              authKind: input.authKind,
              accountLabel,
              encryptedCredential,
              status: "active",
              lastError: null,
              lastVerifiedAt: now(),
            })
            .where(eq(s.codeConnection.id, replaced.id));
          id = replaced.id;
        } else {
          // Connecting the same host and account again restores the
          // archived connection with its repositories, mirror and links.
          const [archived] = await tx
            .select()
            .from(s.codeConnection)
            .where(
              and(
                eq(s.codeConnection.organizationId, organizationId),
                eq(s.codeConnection.provider, input.provider),
                eq(s.codeConnection.baseUrl, baseUrl),
                eq(s.codeConnection.accountLabel, accountLabel),
                sql`${s.codeConnection.archivedAt} is not null`,
              ),
            )
            .orderBy(desc(s.codeConnection.archivedAt))
            .limit(1);
          secret = newWebhookSecret();
          const values = {
            name:
              (input.name ?? "").trim() ||
              `${productName[input.provider]} ${accountLabel}`,
            authKind: input.authKind,
            accountLabel,
            encryptedCredential,
            encryptedWebhookSecret: connections.encrypt(organizationId, secret),
            status: "active" as const,
            lastError: null,
            lastVerifiedAt: now(),
          };
          if (archived) {
            await tx
              .update(s.codeConnection)
              .set({ ...values, archivedAt: null })
              .where(eq(s.codeConnection.id, archived.id));
            id = archived.id;
            const repositoryIds = await connectionRepositoryIds(
              tx,
              organizationId,
              id,
            );
            await touchRepositories(tx, organizationId, repositoryIds, touched);
            await tx
              .update(s.codeRepository)
              .set({ syncDueAt: now() })
              .where(
                and(
                  eq(s.codeRepository.organizationId, organizationId),
                  eq(s.codeRepository.connectionId, id),
                ),
              );
            await signalWork(tx, "code");
          } else {
            const [created] = await tx
              .insert(s.codeConnection)
              .values({
                organizationId,
                provider: input.provider,
                baseUrl,
                createdById: actor.userId,
                ...values,
              })
              .returning({ id: s.codeConnection.id });
            id = created!.id;
          }
        }
        touched.connectionIds.add(id);
        await audit(tx, organizationId, actor.userId, "connectCodeHost", {
          connectionId: id,
          provider: input.provider,
          baseUrl,
          authKind: input.authKind,
          replaced: !!replaced,
        });
        await writeCodeProjections(tx, organizationId, touched.toTouch());
        return {
          connectionId: id,
          accountLabel,
          webhookUrl: `${appUrl()}${webhookPath(id)}`,
          // Shown once, to paste into the host's webhook settings.
          ...(secret ? { webhookSecret: secret } : {}),
        };
      });
    },

    async rotateWebhookSecret(
      actor: Actor,
      organizationId: string,
      connectionId: string,
    ) {
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireCodeHostManager(
          await codeAccess(tx, actor.userId, organizationId),
        );
        await connections.row(tx, organizationId, connectionId);
        const secret = newWebhookSecret();
        await tx
          .update(s.codeConnection)
          .set({
            encryptedWebhookSecret: connections.encrypt(organizationId, secret),
          })
          .where(
            and(
              eq(s.codeConnection.organizationId, organizationId),
              eq(s.codeConnection.id, connectionId),
            ),
          );
        await audit(
          tx,
          organizationId,
          actor.userId,
          "rotateCodeHostWebhookSecret",
          {
            connectionId,
          },
        );
        return {
          connectionId,
          webhookUrl: `${appUrl()}${webhookPath(connectionId)}`,
          webhookSecret: secret,
        };
      });
    },

    // Archives the connection. Repositories, mirrors and links stay as
    // history (connecting the same host and account restores them); writes
    // that were not sent are canceled.
    async disconnect(
      actor: Actor,
      organizationId: string,
      connectionId: string,
    ) {
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireCodeHostManager(
          await codeAccess(tx, actor.userId, organizationId),
        );
        await connections.row(tx, organizationId, connectionId);
        const touched = new Touched();
        touched.connectionIds.add(connectionId);
        const repositoryIds = await connectionRepositoryIds(
          tx,
          organizationId,
          connectionId,
        );
        await touchRepositories(tx, organizationId, repositoryIds, touched);
        await tx
          .update(s.codeConnection)
          .set({ archivedAt: now() })
          .where(
            and(
              eq(s.codeConnection.organizationId, organizationId),
              eq(s.codeConnection.id, connectionId),
            ),
          );
        await tx
          .update(s.codeWrite)
          .set({
            status: "canceled",
            lastError: "The code host was disconnected before this was sent.",
            finishedAt: now(),
          })
          .where(
            and(
              eq(s.codeWrite.organizationId, organizationId),
              eq(s.codeWrite.connectionId, connectionId),
              inArray(s.codeWrite.status, ["queued", "failed"]),
            ),
          );
        await audit(tx, organizationId, actor.userId, "disconnectCodeHost", {
          connectionId,
        });
        await writeCodeProjections(tx, organizationId, touched.toTouch());
      });
    },

    // Repositories the connection can see on its host (live), marked with
    // the projects they already serve.
    async listHostRepositories(
      actor: Actor,
      organizationId: string,
      connectionId: string,
      query?: string,
    ) {
      const row = await db.transaction(async (tx) => {
        const access = await codeAccess(tx, actor.userId, organizationId);
        if (
          !access.roster.projects.some((p) => canLinkRepository(access, p.id))
        )
          throw new DomainError(
            "forbidden",
            "Only organization administrators and project administrators browse a host's repositories.",
          );
        return connections.row(tx, organizationId, connectionId);
      });
      const { provider, connection } = connections.open(row);
      let found;
      try {
        found = await provider.listRepositories(connection, query);
      } catch (error) {
        await connections.markFailure(row, error);
        throw error;
      }
      const linked = await db
        .select({
          externalId: s.codeRepository.externalId,
          projectId: s.codeRepositoryProject.projectId,
        })
        .from(s.codeRepository)
        .innerJoin(
          s.codeRepositoryProject,
          and(
            eq(
              s.codeRepositoryProject.organizationId,
              s.codeRepository.organizationId,
            ),
            eq(s.codeRepositoryProject.repositoryId, s.codeRepository.id),
          ),
        )
        .where(
          and(
            eq(s.codeRepository.organizationId, organizationId),
            eq(s.codeRepository.connectionId, connectionId),
          ),
        );
      return found.slice(0, 200).map((r) => ({
        externalId: r.externalId,
        fullName: r.fullName,
        defaultBranch: r.defaultBranch,
        webUrl: r.webUrl,
        visibility: r.visibility,
        archived: r.archived,
        projectIds: linked
          .filter((l) => l.externalId === r.externalId)
          .map((l) => l.projectId),
      }));
    },

    async linkRepository(
      actor: Actor,
      input: {
        organizationId: string;
        connectionId: string;
        repository: string;
        projectId: string;
      },
    ) {
      const { organizationId } = input;
      const row = await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireRepositoryLinker(
          await codeAccess(tx, actor.userId, organizationId),
          input.projectId,
        );
        return connections.row(tx, organizationId, input.connectionId);
      });
      const { provider, connection } = connections.open(row);
      let info;
      try {
        info = await provider.getRepository(
          connection,
          input.repository.trim(),
        );
      } catch (error) {
        await connections.markFailure(row, error);
        throw error;
      }
      if (!info)
        throw new DomainError(
          "not_found",
          `${productName[row.provider]} has no repository ${input.repository} that ${row.accountLabel} can see.`,
        );
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireRepositoryLinker(
          await codeAccess(tx, actor.userId, organizationId),
          input.projectId,
        );
        await connections.row(tx, organizationId, input.connectionId);
        const values = {
          fullName: info.fullName,
          defaultBranch: info.defaultBranch,
          webUrl: info.webUrl,
          cloneUrl: info.cloneUrl,
          visibility: info.visibility,
          hostArchived: info.archived,
          // Backfill: the worker mirrors it right away.
          syncDueAt: now(),
        };
        const [repository] = await tx
          .insert(s.codeRepository)
          .values({
            organizationId,
            connectionId: input.connectionId,
            externalId: info.externalId,
            ...values,
          })
          .onConflictDoUpdate({
            target: [
              s.codeRepository.organizationId,
              s.codeRepository.connectionId,
              s.codeRepository.externalId,
            ],
            set: values,
          })
          .returning();
        const [added] = await tx
          .insert(s.codeRepositoryProject)
          .values({
            organizationId,
            repositoryId: repository!.id,
            projectId: input.projectId,
            linkedById: actor.userId,
          })
          .onConflictDoNothing()
          .returning();
        if (added)
          await audit(tx, organizationId, actor.userId, "linkCodeRepository", {
            repositoryId: repository!.id,
            fullName: info.fullName,
            projectId: input.projectId,
          });
        await writeCodeProjections(tx, organizationId, {
          repositoryIds: [repository!.id],
        });
        await signalWork(tx, "code");
        return { repositoryId: repository!.id, fullName: info.fullName };
      });
    },

    // The project stops using the repository: key detection no longer
    // links its items. Existing links stay.
    async unlinkRepository(
      actor: Actor,
      input: {
        organizationId: string;
        repositoryId: string;
        projectId: string;
      },
    ) {
      const { organizationId } = input;
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireRepositoryLinker(
          await codeAccess(tx, actor.userId, organizationId),
          input.projectId,
        );
        const deleted = await tx
          .delete(s.codeRepositoryProject)
          .where(
            and(
              eq(s.codeRepositoryProject.organizationId, organizationId),
              eq(s.codeRepositoryProject.repositoryId, input.repositoryId),
              eq(s.codeRepositoryProject.projectId, input.projectId),
            ),
          )
          .returning();
        if (!deleted.length)
          throw new DomainError(
            "not_found",
            "This repository does not serve that project.",
          );
        await audit(tx, organizationId, actor.userId, "unlinkCodeRepository", {
          repositoryId: input.repositoryId,
          projectId: input.projectId,
        });
        await writeCodeProjections(tx, organizationId, {
          repositoryIds: [input.repositoryId],
        });
      });
    },

    // The repository the project's agent sessions work in when a session
    // names none (docs/internals/code-hosts.md#agent-sessions). One per
    // project; null clears the choice (sessions then use the first linked
    // repository).
    async setDefaultRepository(
      actor: Actor,
      input: {
        organizationId: string;
        projectId: string;
        repositoryId: string | null;
      },
    ) {
      const { organizationId } = input;
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        requireRepositoryLinker(
          await codeAccess(tx, actor.userId, organizationId),
          input.projectId,
        );
        const links = await tx
          .select()
          .from(s.codeRepositoryProject)
          .where(
            and(
              eq(s.codeRepositoryProject.organizationId, organizationId),
              eq(s.codeRepositoryProject.projectId, input.projectId),
            ),
          );
        if (
          input.repositoryId &&
          !links.some((l) => l.repositoryId === input.repositoryId)
        )
          throw new DomainError(
            "validation",
            "This repository does not serve the project. Link it first.",
          );
        const previous = links.find((l) => l.isDefault)?.repositoryId ?? null;
        if (previous === input.repositoryId) return;
        // Clear first: the partial unique index allows one default.
        await tx
          .update(s.codeRepositoryProject)
          .set({ isDefault: false })
          .where(
            and(
              eq(s.codeRepositoryProject.organizationId, organizationId),
              eq(s.codeRepositoryProject.projectId, input.projectId),
            ),
          );
        if (input.repositoryId)
          await tx
            .update(s.codeRepositoryProject)
            .set({ isDefault: true })
            .where(
              and(
                eq(s.codeRepositoryProject.organizationId, organizationId),
                eq(s.codeRepositoryProject.projectId, input.projectId),
                eq(s.codeRepositoryProject.repositoryId, input.repositoryId),
              ),
            );
        await audit(
          tx,
          organizationId,
          actor.userId,
          "setDefaultCodeRepository",
          {
            projectId: input.projectId,
            repositoryId: input.repositoryId,
            previousRepositoryId: previous,
          },
        );
        await writeCodeProjections(tx, organizationId, {
          repositoryIds: links.map((l) => l.repositoryId),
        });
      });
      return { ok: true };
    },

    // Mirrors the repository again now (missed webhooks, a new link).
    async requestSync(
      actor: Actor,
      organizationId: string,
      repositoryId: string,
    ) {
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const access = await codeAccess(tx, actor.userId, organizationId);
        await repositoryRow(tx, organizationId, repositoryId);
        const projects = await linkedProjectIds(
          tx,
          organizationId,
          repositoryId,
        );
        if (!access.admin) requireCodeWorker(access, projects, "refresh code");
        await tx
          .update(s.codeRepository)
          .set({ syncDueAt: now() })
          .where(
            and(
              eq(s.codeRepository.organizationId, organizationId),
              eq(s.codeRepository.id, repositoryId),
            ),
          );
        await signalWork(tx, "code");
      });
      return { ok: true };
    },

    // ----------------------------------------------------------- reads

    async listRepositories(actor: Actor, organizationId: string) {
      await member(actor.userId, organizationId);
      return readEntities(
        db,
        organizationId,
        eq(s.codeEntity.type, "codeRepository"),
        500,
      );
    },

    async listPullRequests(
      actor: Actor,
      input: {
        organizationId: string;
        state?: "open" | "closed" | "merged";
        repositoryId?: string;
        projectId?: string;
        workItemId?: string;
        limit?: number;
      },
    ) {
      await member(actor.userId, input.organizationId);
      const rows = (await readEntities(
        db,
        input.organizationId,
        and(
          eq(s.codeEntity.type, "codePullRequest"),
          input.state ? eq(s.codeEntity.facet, input.state) : undefined,
          input.repositoryId
            ? eq(s.codeEntity.repositoryId, input.repositoryId)
            : undefined,
        ),
        input.projectId || input.workItemId ? 1000 : (input.limit ?? 100),
      )) as CodePullRequestEntity[];
      return rows
        .filter(
          (p) =>
            (!input.workItemId ||
              p.links.some((l) => l.workItemId === input.workItemId)) &&
            (!input.projectId ||
              p.links.some((l) => l.projectId === input.projectId)),
        )
        .slice(0, input.limit ?? 100);
    },

    async getPullRequest(
      actor: Actor,
      organizationId: string,
      pullRequestId: string,
    ) {
      await member(actor.userId, organizationId);
      const [pr] = await readEntities(
        db,
        organizationId,
        eq(
          s.codeEntity.key,
          codeEntityKey({ type: "codePullRequest", id: pullRequestId }),
        ),
        1,
      );
      if (!pr)
        throw new DomainError("not_found", "This pull request is unavailable.");
      const writes = await readEntities(
        db,
        organizationId,
        and(
          eq(s.codeEntity.type, "codeWrite"),
          sql`${s.codeEntity.data}->>'pullRequestId' = ${pullRequestId}`,
        ),
        50,
      );
      const p = pr as CodePullRequestEntity;
      return { ...p, mergeBlockers: mergeBlockers(p), writes };
    },

    // The files a pull request changes, read from the host now (Lictory
    // does not store diffs).
    async getPullRequestFiles(
      actor: Actor,
      organizationId: string,
      pullRequestId: string,
    ) {
      const {
        pullRequest,
        repository,
        connection: row,
      } = await db.transaction(async (tx) => {
        await codeAccess(tx, actor.userId, organizationId);
        return pullRequestRow(tx, organizationId, pullRequestId);
      });
      const { provider, connection } = connections.open(row);
      try {
        const files = await provider.listPullRequestFiles(
          connection,
          repository,
          pullRequest.number,
        );
        let budget = 400_000;
        return {
          headSha: pullRequest.headSha,
          files: files.map((f) => {
            const patch = f.patch && f.patch.length <= budget ? f.patch : null;
            if (patch) budget -= patch.length;
            return { ...f, patch, truncated: !!f.patch && !patch };
          }),
        };
      } catch (error) {
        await connections.markFailure(row, error);
        throw error;
      }
    },

    async listIssues(
      actor: Actor,
      input: {
        organizationId: string;
        state?: "open" | "closed";
        repositoryId?: string;
        limit?: number;
      },
    ) {
      await member(actor.userId, input.organizationId);
      return readEntities(
        db,
        input.organizationId,
        and(
          eq(s.codeEntity.type, "codeIssue"),
          input.state ? eq(s.codeEntity.facet, input.state) : undefined,
          input.repositoryId
            ? eq(s.codeEntity.repositoryId, input.repositoryId)
            : undefined,
        ),
        input.limit ?? 100,
      );
    },

    // Mirrored branches (those that name a work item, were created by
    // Lictory or are a linked pull request's head) of a repository, or of
    // the repositories serving a project, with the items each is linked to.
    async listBranches(
      actor: Actor,
      input: {
        organizationId: string;
        repositoryId?: string;
        projectId?: string;
        includeDeleted?: boolean;
      },
    ) {
      const { organizationId } = input;
      return db.transaction(async (tx) => {
        await codeAccess(tx, actor.userId, organizationId);
        const repositoryIds = input.repositoryId
          ? [input.repositoryId]
          : input.projectId
            ? (
                await tx
                  .select({ id: s.codeRepositoryProject.repositoryId })
                  .from(s.codeRepositoryProject)
                  .where(
                    and(
                      eq(
                        s.codeRepositoryProject.organizationId,
                        organizationId,
                      ),
                      eq(s.codeRepositoryProject.projectId, input.projectId),
                    ),
                  )
              ).map((r) => r.id)
            : undefined;
        if (repositoryIds && !repositoryIds.length) return [];
        const rows = await tx
          .select({ branch: s.codeBranch, repository: s.codeRepository })
          .from(s.codeBranch)
          .innerJoin(
            s.codeRepository,
            and(
              eq(s.codeRepository.organizationId, s.codeBranch.organizationId),
              eq(s.codeRepository.id, s.codeBranch.repositoryId),
            ),
          )
          .where(
            and(
              eq(s.codeBranch.organizationId, organizationId),
              repositoryIds
                ? inArray(s.codeBranch.repositoryId, repositoryIds)
                : undefined,
              input.includeDeleted ? undefined : isNull(s.codeBranch.deletedAt),
            ),
          )
          .orderBy(desc(s.codeBranch.updatedAt))
          .limit(300);
        const links = rows.length
          ? await tx
              .select({
                targetId: s.codeWorkLink.targetId,
                workItemId: s.codeWorkLink.workItemId,
              })
              .from(s.codeWorkLink)
              .where(
                and(
                  eq(s.codeWorkLink.organizationId, organizationId),
                  eq(s.codeWorkLink.target, "branch"),
                  isNull(s.codeWorkLink.unlinkedAt),
                  inArray(
                    s.codeWorkLink.targetId,
                    rows.map((r) => r.branch.id),
                  ),
                ),
              )
          : [];
        return rows.map(({ branch, repository }) => ({
          branchId: branch.id,
          repositoryId: repository.id,
          repositoryFullName: repository.fullName,
          name: branch.name,
          headSha: branch.headSha,
          deleted: !!branch.deletedAt,
          workItemIds: links
            .filter((l) => l.targetId === branch.id)
            .map((l) => l.workItemId),
        }));
      });
    },

    // Branches, pull requests, issues and commits linked to one item, and
    // the writes queued for it.
    async workItemCode(
      actor: Actor,
      organizationId: string,
      workItemId: string,
    ) {
      await member(actor.userId, organizationId);
      const rows = await readEntities(
        db,
        organizationId,
        and(
          eq(s.codeEntity.workItemId, workItemId),
          inArray(s.codeEntity.type, ["codeLink", "codeWrite"]),
        ),
        500,
      );
      return {
        links: rows.filter((r): r is CodeLinkEntity => r.type === "codeLink"),
        writes: rows.filter(
          (r): r is CodeWriteEntity => r.type === "codeWrite",
        ),
      };
    },

    async suggestBranchName(
      actor: Actor,
      organizationId: string,
      workItemId: string,
    ) {
      return db.transaction(async (tx) => {
        await codeAccess(tx, actor.userId, organizationId);
        const { item, project } = await itemRow(tx, organizationId, workItemId);
        const repositories = await tx
          .select({
            id: s.codeRepository.id,
            fullName: s.codeRepository.fullName,
          })
          .from(s.codeRepositoryProject)
          .innerJoin(
            s.codeRepository,
            and(
              eq(
                s.codeRepository.organizationId,
                s.codeRepositoryProject.organizationId,
              ),
              eq(s.codeRepository.id, s.codeRepositoryProject.repositoryId),
            ),
          )
          .where(
            and(
              eq(s.codeRepositoryProject.organizationId, organizationId),
              eq(s.codeRepositoryProject.projectId, project.id),
            ),
          );
        return {
          key: `${project.key}-${item.number}`,
          branchName: suggestBranchName(
            `${project.key}-${item.number}`,
            item.title,
          ),
          repositories,
        };
      });
    },

    // ----------------------------------------------------------- links

    async linkCode(
      actor: Actor,
      input: {
        organizationId: string;
        workItemId: string;
        repositoryId: string;
        target: CodeLinkTarget;
        // Branch name, pull request or issue number, or commit SHA.
        ref: string;
        agentSessionId?: string;
      },
    ) {
      const { organizationId } = input;
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const access = await codeAccess(tx, actor.userId, organizationId);
        const { item, project } = await itemRow(
          tx,
          organizationId,
          input.workItemId,
        );
        requireCodeWorker(access, [item.projectId], "link code to this item");
        const { repository } = await repositoryRow(
          tx,
          organizationId,
          input.repositoryId,
        );
        const projects = await linkedProjectIds(
          tx,
          organizationId,
          repository.id,
        );
        if (!projects.includes(item.projectId))
          throw new DomainError(
            "validation",
            `${repository.fullName} does not serve ${project.name}. A project administrator can link it in the project's settings.`,
          );
        const ref = input.ref.trim();
        const target = await findTarget(
          tx,
          organizationId,
          repository.id,
          input.target,
          ref,
        );
        if (!target)
          throw new DomainError(
            "not_found",
            `Lictory has not seen ${describeTarget(input.target, ref)} in ${repository.fullName} yet. Refresh the repository or wait for its webhook.`,
          );
        const touched = new Touched();
        const { link, created } = await addLink(
          tx,
          {
            organizationId,
            workItemId: item.id,
            projectId: item.projectId,
            repositoryId: repository.id,
            target: input.target,
            targetId: target.id,
            source: input.agentSessionId ? "agent_session" : "manual",
            createdById: actor.userId,
            performedVia: performedVia(actor),
            agentSessionId: input.agentSessionId ?? null,
            ref: target.label,
            url: target.url,
          },
          touched,
        );
        await writeCodeProjections(tx, organizationId, touched.toTouch());
        return { linkId: link!.id, created };
      });
    },

    // Unlinking is recorded: the link keeps who removed it and when, and
    // key detection does not link the same code to the item again.
    async unlinkCode(actor: Actor, organizationId: string, linkId: string) {
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const access = await codeAccess(tx, actor.userId, organizationId);
        const [link] = await tx
          .select()
          .from(s.codeWorkLink)
          .where(
            and(
              eq(s.codeWorkLink.organizationId, organizationId),
              eq(s.codeWorkLink.id, linkId),
            ),
          );
        if (!link)
          throw new DomainError("not_found", "This link is unavailable.");
        requireCodeWorker(
          access,
          [link.projectId],
          "unlink code from this item",
        );
        if (link.unlinkedAt) return { linkId, unlinked: false };
        await tx
          .update(s.codeWorkLink)
          .set({ unlinkedAt: now(), unlinkedById: actor.userId })
          .where(eq(s.codeWorkLink.id, link.id));
        const target = await targetLabel(tx, organizationId, link);
        await recordActivity(tx, {
          organizationId,
          projectId: link.projectId,
          workItemId: link.workItemId,
          actorId: actor.userId,
          action: "code_unlinked",
          detail: {
            target: link.target,
            ref: target.label,
            url: target.url,
            ...(performedVia(actor)
              ? { performedVia: performedVia(actor) }
              : {}),
          },
        });
        await writeCodeProjections(tx, organizationId, {
          workItemIds: [link.workItemId],
          targetIds: [link.targetId],
          ...(link.target === "pull_request"
            ? { pullRequestIds: [link.targetId] }
            : {}),
          ...(link.target === "issue" ? { issueIds: [link.targetId] } : {}),
        });
        return { linkId, unlinked: true };
      });
    },

    // ---------------------------------------------------------- writes

    async createBranch(
      actor: Actor,
      input: {
        organizationId: string;
        workItemId: string;
        repositoryId?: string;
        name?: string;
        from?: string;
        mutationId?: string;
      },
    ) {
      const { organizationId } = input;
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const access = await codeAccess(tx, actor.userId, organizationId);
        const { item, project } = await itemRow(
          tx,
          organizationId,
          input.workItemId,
        );
        if (item.archivedAt)
          throw new DomainError("validation", "This item is archived.");
        requireCodeWorker(
          access,
          [item.projectId],
          "create branches for this item",
        );
        const repository = await repositoryForItem(
          tx,
          organizationId,
          project,
          input.repositoryId,
        );
        const key = `${project.key}-${item.number}`;
        const name =
          (input.name ?? "").trim() || suggestBranchName(key, item.title);
        const problem = branchNameProblem(name);
        if (problem) throw new DomainError("validation", problem);
        const touched = new Touched();
        const { write, replayed } = await enqueue(
          tx,
          actor,
          {
            organizationId,
            connectionId: repository.connectionId,
            repositoryId: repository.id,
            kind: "create_branch",
            payload: {
              name,
              from: (input.from ?? "").trim() || repository.defaultBranch,
            },
            workItemId: item.id,
            idempotencyKey: input.mutationId,
          },
          touched,
        );
        await writeCodeProjections(tx, organizationId, touched.toTouch());
        return {
          ...writeView(write),
          replayed,
          branchName: name,
          repositoryId: repository.id,
        };
      });
    },

    async openPullRequest(
      actor: Actor,
      input: {
        organizationId: string;
        repositoryId?: string;
        workItemId?: string;
        head: string;
        base?: string;
        title?: string;
        body?: string;
        draft?: boolean;
        mutationId?: string;
      },
    ) {
      const { organizationId } = input;
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const access = await codeAccess(tx, actor.userId, organizationId);
        let repository: typeof s.codeRepository.$inferSelect;
        let title = (input.title ?? "").trim();
        let body = input.body ?? "";
        let workItemId: string | null = null;
        if (input.workItemId) {
          const { item, project } = await itemRow(
            tx,
            organizationId,
            input.workItemId,
          );
          requireCodeWorker(
            access,
            [item.projectId],
            "open pull requests for this item",
          );
          repository = await repositoryForItem(
            tx,
            organizationId,
            project,
            input.repositoryId,
          );
          const key = `${project.key}-${item.number}`;
          if (!title) title = `${key}: ${item.title}`;
          const [org] = await tx
            .select({ slug: s.organization.slug })
            .from(s.organization)
            .where(eq(s.organization.id, organizationId));
          const url = `${appUrl()}${paths.item(org!.slug, project.key, item.id)}`;
          body = `${body.trim()}${body.trim() ? "\n\n" : ""}Lictory: [${key}](${url})`;
          workItemId = item.id;
        } else {
          if (!input.repositoryId)
            throw new DomainError(
              "validation",
              "Choose a repository or a work item.",
            );
          repository = (
            await repositoryRow(tx, organizationId, input.repositoryId)
          ).repository;
          requireCodeWorker(
            access,
            await linkedProjectIds(tx, organizationId, repository.id),
            "open pull requests in this repository",
          );
          if (!title)
            throw new DomainError(
              "validation",
              "Give the pull request a title.",
            );
        }
        const head = input.head.trim();
        if (!head)
          throw new DomainError("validation", "Name the branch to merge from.");
        const base = (input.base ?? "").trim() || repository.defaultBranch;
        if (head === base)
          throw new DomainError(
            "validation",
            "A pull request needs a branch other than its base.",
          );
        const touched = new Touched();
        const { write, replayed } = await enqueue(
          tx,
          actor,
          {
            organizationId,
            connectionId: repository.connectionId,
            repositoryId: repository.id,
            kind: "open_pull_request",
            payload: {
              head,
              base,
              title: title.slice(0, 250),
              body: body.slice(0, 60_000),
              draft: input.draft ?? false,
            },
            workItemId,
            idempotencyKey: input.mutationId,
          },
          touched,
        );
        await writeCodeProjections(tx, organizationId, touched.toTouch());
        return { ...writeView(write), replayed, repositoryId: repository.id };
      });
    },

    async comment(
      actor: Actor,
      input: {
        organizationId: string;
        pullRequestId: string;
        body: string;
        mutationId?: string;
      },
    ) {
      return pullRequestWrite(actor, input, "comment", async (tx, pr) => {
        const text = input.body.trim();
        if (!text)
          throw new DomainError("validation", "Write a comment first.");
        return {
          kind: "comment" as const,
          payload: {
            number: pr.number,
            body: `${text.slice(0, 60_000)}\n\n— ${await signature(tx, actor)}, from Lictory`,
          },
        };
      });
    },

    async requestReview(
      actor: Actor,
      input: {
        organizationId: string;
        pullRequestId: string;
        reviewers: string[];
        mutationId?: string;
      },
    ) {
      return pullRequestWrite(actor, input, "requestReview", (_tx, pr) => {
        const reviewers = [
          ...new Set(
            input.reviewers
              .map((r) => r.trim().replace(/^@/, ""))
              .filter(Boolean),
          ),
        ];
        if (!reviewers.length)
          throw new DomainError("validation", "Name at least one reviewer.");
        return Promise.resolve({
          kind: "request_review" as const,
          payload: { number: pr.number, reviewers },
        });
      });
    },

    // A merge is a decision: a person asks for it (or the autonomy policy,
    // through `mergeForPolicyIn`), for the head they inspected.
    async merge(
      actor: Actor,
      input: {
        organizationId: string;
        pullRequestId: string;
        expectedHeadSha: string;
        method?: CodeMergeMethod;
        mutationId?: string;
      },
      policy?: { performedVia: string },
    ) {
      return pullRequestWrite(
        actor,
        input,
        "merge",
        mergeBuild(input),
        policy?.performedVia,
      );
    },

    // Autopilot's merge (docs/internals/claims.md#the-dispatcher), in the
    // claims transaction under the organization lock. The merge follows a
    // person's merge rules (state, draft, checks, requested changes,
    // conflicts, the head it was decided for), is attributed to the policy
    // and the administrator who set it ("Autopilot · policy set by Ada"),
    // who must still administer the project the repository serves, and a
    // comment on the pull request says so on the host. A refusal returns
    // its reason and writes nothing.
    async mergeForPolicyIn(
      tx: Tx,
      input: {
        organizationId: string;
        pullRequestId: string;
        expectedHeadSha: string;
        method?: CodeMergeMethod;
        // One merge per policy decision: retries reuse it.
        idempotencyKey: string;
        policy: {
          projectId: string;
          configuredById: string;
          version: number;
          label?: string;
        };
        // What the comment on the host says passed.
        explanation?: string;
      },
    ): Promise<
      | { requested: true; writeId: string | null }
      | {
          requested: false;
          reason: string;
          category: DomainError["category"];
        }
    > {
      const { policy } = input;
      const [admin] = await tx
        .select({ name: s.user.name })
        .from(s.user)
        .where(eq(s.user.id, policy.configuredById));
      const via =
        `${policy.label ?? "Autopilot"} · policy set by ${admin?.name ?? "a project administrator"}`.slice(
          0,
          200,
        );
      const actor: Actor = {
        userId: policy.configuredById,
        automation: "autopilot",
      };
      const authorize = (access: CodeAccess, projects: string[]) => {
        if (
          !canManageProject(
            access.roster,
            policy.configuredById,
            access.admin,
            policy.projectId,
          )
        )
          throw new DomainError(
            "forbidden",
            "The administrator who set this project's autonomy policy no longer administers it; Autopilot does not merge until a current administrator saves the policy again.",
          );
        if (!projects.includes(policy.projectId))
          throw new DomainError(
            "forbidden",
            "This pull request's repository does not serve the project whose policy would merge it.",
          );
      };
      const request = {
        organizationId: input.organizationId,
        pullRequestId: input.pullRequestId,
      };
      try {
        // A savepoint: a refusal leaves the caller's transaction intact.
        return await tx.transaction(async (inner) => {
          const merge = await pullRequestWriteIn(
            inner,
            actor,
            { ...request, mutationId: `autopilot:${input.idempotencyKey}` },
            "merge",
            mergeBuild(input),
            via,
            authorize,
          );
          await pullRequestWriteIn(
            inner,
            actor,
            {
              ...request,
              mutationId: `autopilot-comment:${input.idempotencyKey}`,
            },
            "comment",
            (_tx, pr) =>
              Promise.resolve({
                kind: "comment" as const,
                payload: {
                  number: pr.number,
                  body: `${(input.explanation ?? `Autopilot merges this pull request at ${pr.headSha.slice(0, 7)}: every required check passed.`).slice(0, 4000)}\n\nAutopilot is on for this project under the autonomy policy (version ${policy.version}) that ${admin?.name ?? "a project administrator"} set. Lowering the project's autonomy stops it.\n\n— ${via}, from Lictory`,
                },
              }),
            via,
            authorize,
          );
          return { requested: true as const, writeId: merge.writeId };
        });
      } catch (error) {
        if (error instanceof DomainError)
          return {
            requested: false,
            reason: error.message,
            category: error.category,
          };
        throw error;
      }
    },

    // A review recorded in Lictory, bound to the head commit it reviewed
    // (docs/internals/code-hosts.md#reviews-recorded-in-lictory). Every
    // write to a host carries the connection's identity, so the host cannot
    // say which agent approved: the review is Lictory's record, which the
    // Definition of Done reads, and a comment on the pull request shows it
    // on the host. A new head needs a new review.
    async reviewPullRequest(
      actor: Actor,
      input: {
        organizationId: string;
        pullRequestId: string;
        decision: "approve" | "request_changes";
        body?: string;
        // The head the reviewer read; a newer one refuses the review.
        expectedHeadSha?: string;
        mutationId?: string;
      },
    ) {
      const { organizationId } = input;
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const access = await codeAccess(tx, actor.userId, organizationId);
        const { pullRequest, repository } = await pullRequestRow(
          tx,
          organizationId,
          input.pullRequestId,
        );
        const projects = await linkedProjectIds(
          tx,
          organizationId,
          repository.id,
        );
        requireCodeWorker(access, projects, "review pull requests");
        requireStep(codePullRequest, pullRequest.state, "review");
        const expected = input.expectedHeadSha?.trim();
        if (expected && expected !== pullRequest.headSha)
          throw new DomainError(
            "conflict",
            `The pull request has new commits (head ${pullRequest.headSha.slice(0, 7)}) since you read ${expected.slice(0, 7)}. Review the current head.`,
            undefined,
            "stale_head",
          );
        const agentId = actor.agentScope?.id ?? null;
        if (agentId && pullRequest.agentId === agentId)
          throw new DomainError(
            "forbidden",
            "An agent does not review its own pull request. The project's reviewer agent or a person reviews it.",
          );
        const reviewId = input.mutationId
          ? createHash("sha256")
              .update(`code-review:${organizationId}:${input.mutationId}`)
              .digest("hex")
              .slice(0, 32)
          : crypto.randomUUID();
        const [existing] = await tx
          .select()
          .from(s.codeReview)
          .where(
            and(
              eq(s.codeReview.organizationId, organizationId),
              eq(s.codeReview.id, reviewId),
            ),
          );
        if (existing)
          return {
            reviewId: existing.id,
            headSha: existing.headSha,
            decision: existing.decision,
            replayed: true,
          };
        // The reviewer's earlier reviews of this pull request give way.
        await tx
          .update(s.codeReview)
          .set({ supersededAt: now() })
          .where(
            and(
              eq(s.codeReview.organizationId, organizationId),
              eq(s.codeReview.pullRequestId, pullRequest.id),
              isNull(s.codeReview.supersededAt),
              agentId
                ? eq(s.codeReview.agentId, agentId)
                : and(
                    eq(s.codeReview.reviewerId, actor.userId),
                    isNull(s.codeReview.agentId),
                  ),
            ),
          );
        const body = (input.body ?? "").trim().slice(0, 20_000);
        const agentName = performedVia(actor);
        await tx.insert(s.codeReview).values({
          id: reviewId,
          organizationId,
          pullRequestId: pullRequest.id,
          headSha: pullRequest.headSha,
          decision: input.decision,
          body,
          reviewerId: actor.userId,
          agentId,
          agentName,
          agentSessionId:
            actor.agentSessionId ?? actor.agentScope?.sessionId ?? null,
        });
        const touched = new Touched();
        touched.pullRequestIds.add(pullRequest.id);
        // Shown on the host too, signed, since the host shows the
        // connection's account as its author.
        const verdict =
          input.decision === "approve" ? "Approved" : "Changes requested";
        await enqueue(
          tx,
          actor,
          {
            organizationId,
            connectionId: repository.connectionId,
            repositoryId: repository.id,
            kind: "comment",
            payload: {
              number: pullRequest.number,
              body: `**${verdict}** at ${pullRequest.headSha.slice(0, 7)}${body ? `\n\n${body.slice(0, 60_000)}` : ""}\n\n— ${await signature(tx, actor)}, from Lictory`,
            },
            pullRequestId: pullRequest.id,
            idempotencyKey: `code-review:${reviewId}`,
          },
          touched,
        );
        const linked = await tx
          .select({
            workItemId: s.codeWorkLink.workItemId,
            projectId: s.codeWorkLink.projectId,
          })
          .from(s.codeWorkLink)
          .where(
            and(
              eq(s.codeWorkLink.organizationId, organizationId),
              eq(s.codeWorkLink.target, "pull_request"),
              eq(s.codeWorkLink.targetId, pullRequest.id),
              isNull(s.codeWorkLink.unlinkedAt),
            ),
          );
        for (const link of linked) {
          touched.workItemIds.add(link.workItemId);
          await recordActivity(tx, {
            organizationId,
            projectId: link.projectId,
            workItemId: link.workItemId,
            actorId: actor.userId,
            action:
              input.decision === "approve"
                ? "code_review_approved"
                : "code_review_changes_requested",
            detail: {
              pullRequestId: pullRequest.id,
              number: pullRequest.number,
              title: pullRequest.title,
              url: pullRequest.webUrl,
              headSha: pullRequest.headSha,
              ...(agentName ? { performedVia: agentName } : {}),
              ...(agentId ? { agentId } : {}),
            },
          });
        }
        await writeCodeProjections(tx, organizationId, touched.toTouch());
        // The Definition of Done reads the review.
        await followCodeEvidence(tx, organizationId, touched);
        return {
          reviewId,
          headSha: pullRequest.headSha,
          decision: input.decision,
          replayed: false,
        };
      });
    },

    // The pull request an agent session's pushed branch becomes
    // (docs/internals/code-hosts.md#pull-requests-from-agent-sessions):
    // opened through the outbox as the agent acting for its owner, for the
    // session's work item, idempotent by the head branch (the outbox looks
    // for the branch's open pull request before opening one). A branch
    // whose open pull request another session opened (a reviewer pushed to
    // it) opens nothing.
    async openSessionPullRequest(
      actor: Actor,
      input: {
        organizationId: string;
        sessionId: string;
        // Stable per run, so a repeated completion queues one write.
        attempt: number;
        repositoryId: string;
        workItemId: string | null;
        head: string;
        base?: string | null;
        title?: string;
        body?: string;
      },
    ) {
      const [open] = await db
        .select()
        .from(s.codePullRequest)
        .where(
          and(
            eq(s.codePullRequest.organizationId, input.organizationId),
            eq(s.codePullRequest.repositoryId, input.repositoryId),
            eq(s.codePullRequest.headBranch, input.head),
            eq(s.codePullRequest.state, "open"),
          ),
        );
      if (open?.agentSessionId && open.agentSessionId !== input.sessionId)
        return { outcome: "skipped" as const, pullRequestId: open.id };
      const queued = await this.openPullRequest(actor, {
        organizationId: input.organizationId,
        repositoryId: input.repositoryId,
        workItemId: input.workItemId ?? undefined,
        head: input.head,
        base: input.base ?? undefined,
        title: input.title,
        body: input.body,
        mutationId: `session-pr:${input.sessionId}:${input.attempt}`,
      });
      return { outcome: "queued" as const, ...queued };
    },

    async setPullRequestState(
      actor: Actor,
      input: {
        organizationId: string;
        pullRequestId: string;
        state: "open" | "closed";
        mutationId?: string;
      },
    ) {
      return pullRequestWrite(
        actor,
        input,
        input.state === "closed" ? "close" : "reopen",
        (_tx, pr) =>
          Promise.resolve({
            kind:
              input.state === "closed"
                ? ("close" as const)
                : ("reopen" as const),
            payload: { number: pr.number },
          }),
      );
    },

    async retryWrite(actor: Actor, organizationId: string, writeId: string) {
      return settleWrite(actor, organizationId, writeId, "retry");
    },

    async cancelWrite(actor: Actor, organizationId: string, writeId: string) {
      return settleWrite(actor, organizationId, writeId, "cancel");
    },

    async getWrite(actor: Actor, organizationId: string, writeId: string) {
      return db.transaction(async (tx) => {
        await codeAccess(tx, actor.userId, organizationId);
        const [write] = await tx
          .select()
          .from(s.codeWrite)
          .where(
            and(
              eq(s.codeWrite.organizationId, organizationId),
              eq(s.codeWrite.id, writeId),
            ),
          );
        if (!write)
          throw new DomainError("not_found", "This write is unavailable.");
        return {
          ...writeView(write),
          attempts: write.attempts,
          createdAt: write.createdAt,
        };
      });
    },

    // ---------------------------------------------------------- issues

    // The issue becomes a Lictory work item: from now on the item is
    // Lictory's (title, description, status) and the issue stays linked.
    async importIssue(
      actor: Actor,
      input: {
        organizationId: string;
        issueId: string;
        projectId: string;
        typeId?: string;
        mutationId?: string;
      },
    ) {
      const { organizationId } = input;
      return db.transaction(async (tx) => {
        await lock(tx, organizationId);
        const access = await codeAccess(tx, actor.userId, organizationId);
        const [issue] = await tx
          .select()
          .from(s.codeIssue)
          .where(
            and(
              eq(s.codeIssue.organizationId, organizationId),
              eq(s.codeIssue.id, input.issueId),
            ),
          );
        if (!issue)
          throw new DomainError("not_found", "This issue is unavailable.");
        const { repository } = await repositoryRow(
          tx,
          organizationId,
          issue.repositoryId,
        );
        if (issue.importedWorkItemId)
          return { workItemId: issue.importedWorkItemId, imported: false };
        const projects = await linkedProjectIds(
          tx,
          organizationId,
          repository.id,
        );
        if (!projects.includes(input.projectId))
          throw new DomainError(
            "validation",
            `${repository.fullName} does not serve that project. A project administrator can link it first.`,
          );
        requireCodeWorker(
          access,
          [input.projectId],
          "import issues into this project",
        );
        const typeId =
          input.typeId ??
          defaultImportType(access, input.projectId, issue.labels);
        const workItemId = crypto.randomUUID();
        await applyMutation(tx, actor, {
          protocol: PROTOCOL,
          id: input.mutationId ?? crypto.randomUUID(),
          organizationId,
          command: {
            type: "createWorkItem",
            projectId: input.projectId,
            workItemId,
            typeId,
            parentId: null,
            title: issue.title.slice(0, 240) || `Issue #${issue.number}`,
            description: `${issue.bodyExcerpt}${issue.bodyExcerpt ? "\n\n" : ""}Imported from [${repository.fullName}#${issue.number}](${issue.webUrl}).`,
          },
        });
        await tx
          .update(s.codeIssue)
          .set({ importedWorkItemId: workItemId })
          .where(eq(s.codeIssue.id, issue.id));
        const touched = new Touched();
        touched.issueIds.add(issue.id);
        await addLink(
          tx,
          {
            organizationId,
            workItemId,
            projectId: input.projectId,
            repositoryId: repository.id,
            target: "issue",
            targetId: issue.id,
            source: "import",
            createdById: actor.userId,
            performedVia: performedVia(actor),
            ref: `${repository.fullName}#${issue.number}`,
            url: issue.webUrl,
          },
          touched,
        );
        await writeCodeProjections(tx, organizationId, touched.toTouch());
        return { workItemId, imported: true };
      });
    },

    // The login a person uses on a host, for filters ("mine", "review
    // requested"). Grants nothing.
    async setIdentity(
      actor: Actor,
      input: {
        organizationId: string;
        connectionId: string;
        login: string | null;
      },
    ) {
      const { organizationId } = input;
      await db.transaction(async (tx) => {
        await lock(tx, organizationId);
        await codeAccess(tx, actor.userId, organizationId);
        await connections.row(tx, organizationId, input.connectionId);
        const login = input.login?.trim().replace(/^@/, "");
        if (login)
          await tx
            .insert(s.codeHostIdentity)
            .values({
              organizationId,
              connectionId: input.connectionId,
              userId: actor.userId,
              login,
            })
            .onConflictDoUpdate({
              target: [
                s.codeHostIdentity.organizationId,
                s.codeHostIdentity.connectionId,
                s.codeHostIdentity.userId,
              ],
              set: { login },
            });
        else
          await tx
            .delete(s.codeHostIdentity)
            .where(
              and(
                eq(s.codeHostIdentity.organizationId, organizationId),
                eq(s.codeHostIdentity.connectionId, input.connectionId),
                eq(s.codeHostIdentity.userId, actor.userId),
              ),
            );
        await writeCodeProjections(tx, organizationId, {
          identityUserIds: [actor.userId],
        });
      });
      return { ok: true };
    },
  };

  // A write about one pull request: authorized in a project its
  // repository serves, refused by the pull request's state machine.
  async function pullRequestWrite(
    actor: Actor,
    input: PullRequestWriteInput,
    step: PullRequestStep,
    build: PullRequestWriteBuild,
    via?: string,
  ) {
    return db.transaction(async (tx) => {
      await lock(tx, input.organizationId);
      return pullRequestWriteIn(tx, actor, input, step, build, via);
    });
  }

  // The same, in the caller's transaction (which holds the organization
  // lock). `authorize` replaces the code-worker check: the autonomy policy
  // merges on its administrator's authority.
  async function pullRequestWriteIn(
    tx: Tx,
    actor: Actor,
    input: PullRequestWriteInput,
    step: PullRequestStep,
    build: PullRequestWriteBuild,
    via?: string,
    authorize?: (access: CodeAccess, projects: string[]) => void,
  ) {
    const { organizationId } = input;
    {
      const access = await codeAccess(tx, actor.userId, organizationId);
      const { pullRequest, repository } = await pullRequestRow(
        tx,
        organizationId,
        input.pullRequestId,
      );
      const projects = await linkedProjectIds(
        tx,
        organizationId,
        repository.id,
      );
      const verbs = {
        comment: "comment on pull requests",
        requestReview: "request reviews",
        merge: "merge pull requests",
        close: "close pull requests",
        reopen: "reopen pull requests",
      };
      if (authorize) authorize(access, projects);
      else requireCodeWorker(access, projects, verbs[step]);
      requireStep(codePullRequest, pullRequest.state, step);
      // Asking for the state it is already in changes nothing.
      if (codePullRequest.targets(step).includes(pullRequest.state))
        return {
          writeId: null,
          kind: null,
          status: "succeeded" as const,
          lastError: null,
          result: { unchanged: true, state: pullRequest.state },
          replayed: false,
        };
      const built = await build(tx, pullRequest);
      if (built.reuseInFlight) {
        const [inFlight] = await tx
          .select()
          .from(s.codeWrite)
          .where(
            and(
              eq(s.codeWrite.organizationId, organizationId),
              eq(s.codeWrite.pullRequestId, pullRequest.id),
              eq(s.codeWrite.kind, built.kind),
              inArray(s.codeWrite.status, ["queued", "sending"]),
            ),
          );
        if (inFlight) return { ...writeView(inFlight), replayed: true };
      }
      const touched = new Touched();
      const { write, replayed } = await enqueue(
        tx,
        actor,
        {
          organizationId,
          connectionId: repository.connectionId,
          repositoryId: repository.id,
          kind: built.kind,
          payload: built.payload,
          pullRequestId: pullRequest.id,
          idempotencyKey: input.mutationId,
          performedVia: via,
        },
        touched,
      );
      await writeCodeProjections(tx, organizationId, touched.toTouch());
      return { ...writeView(write), replayed };
    }
  }

  async function settleWrite(
    actor: Actor,
    organizationId: string,
    writeId: string,
    step: "retry" | "cancel",
  ) {
    return db.transaction(async (tx) => {
      await lock(tx, organizationId);
      const access = await codeAccess(tx, actor.userId, organizationId);
      const [write] = await tx
        .select()
        .from(s.codeWrite)
        .where(
          and(
            eq(s.codeWrite.organizationId, organizationId),
            eq(s.codeWrite.id, writeId),
          ),
        );
      if (!write)
        throw new DomainError("not_found", "This write is unavailable.");
      if (write.requestedById !== actor.userId)
        requireCodeWorker(
          access,
          await linkedProjectIds(tx, organizationId, write.repositoryId),
          step === "retry" ? "retry writes" : "cancel writes",
        );
      requireStep(codeWriteMachine, write.status, step);
      if (step === "cancel" && write.status === "canceled")
        return writeView(write);
      const [updated] = await tx
        .update(s.codeWrite)
        .set(
          step === "retry"
            ? {
                status: "queued",
                nextAttemptAt: now(),
                leaseUntil: null,
                lastError: null,
              }
            : { status: "canceled", finishedAt: now() },
        )
        .where(eq(s.codeWrite.id, write.id))
        .returning();
      if (step === "retry") await signalWork(tx, "code");
      await writeCodeProjections(tx, organizationId, {
        writeIds: [write.id],
        ...(write.workItemId ? { workItemIds: [write.workItemId] } : {}),
      });
      return writeView(updated!);
    });
  }

  async function repositoryForItem(
    tx: Tx,
    organizationId: string,
    project: typeof s.project.$inferSelect,
    repositoryId: string | undefined,
  ) {
    const repositories = await tx
      .select({
        repository: s.codeRepository,
        isDefault: s.codeRepositoryProject.isDefault,
      })
      .from(s.codeRepositoryProject)
      .innerJoin(
        s.codeRepository,
        and(
          eq(
            s.codeRepository.organizationId,
            s.codeRepositoryProject.organizationId,
          ),
          eq(s.codeRepository.id, s.codeRepositoryProject.repositoryId),
        ),
      )
      .innerJoin(
        s.codeConnection,
        and(
          eq(s.codeConnection.organizationId, s.codeRepository.organizationId),
          eq(s.codeConnection.id, s.codeRepository.connectionId),
        ),
      )
      .where(
        and(
          eq(s.codeRepositoryProject.organizationId, organizationId),
          eq(s.codeRepositoryProject.projectId, project.id),
          isNull(s.codeConnection.archivedAt),
        ),
      );
    if (!repositories.length)
      throw new DomainError(
        "validation",
        `${project.name} has no repository yet. A project administrator can link one in the project's settings.`,
      );
    if (repositoryId) {
      const found = repositories.find((r) => r.repository.id === repositoryId);
      if (!found)
        throw new DomainError(
          "validation",
          `That repository does not serve ${project.name}.`,
        );
      return found.repository;
    }
    const preferred = repositories.find((r) => r.isDefault);
    if (preferred) return preferred.repository;
    if (repositories.length > 1)
      throw new DomainError(
        "validation",
        `${project.name} uses several repositories (${repositories.map((r) => r.repository.fullName).join(", ")}). Choose one, or a project administrator sets the default in the project's settings.`,
      );
    return repositories[0]!.repository;
  }
}

// What a merge sends, refused for the reasons a person's merge is.
function mergeBuild(input: {
  organizationId: string;
  expectedHeadSha: string;
  method?: CodeMergeMethod;
}): PullRequestWriteBuild {
  return async (tx, pr) => {
    const [checks] = await tx
      .select()
      .from(s.codeCommitChecks)
      .where(
        and(
          eq(s.codeCommitChecks.organizationId, input.organizationId),
          eq(s.codeCommitChecks.repositoryId, pr.repositoryId),
          eq(s.codeCommitChecks.sha, pr.headSha),
        ),
      );
    const blockers = mergeBlockers({
      ...pr,
      checks: checks ?? { state: "none" },
    });
    if (blockers.length)
      throw new DomainError(
        "conflict",
        `Not merged: ${blockers[0]}`,
        undefined,
        "merge_blocked",
      );
    if (input.expectedHeadSha.trim() !== pr.headSha)
      throw new DomainError(
        "conflict",
        "The pull request has new commits since it was checked. Review the current head before merging.",
        undefined,
        "stale_head",
      );
    return {
      kind: "merge" as const,
      payload: {
        number: pr.number,
        method: input.method ?? "merge",
        expectedHeadSha: pr.headSha,
      },
      reuseInFlight: true,
    };
  };
}

type PullRequestWriteInput = {
  organizationId: string;
  pullRequestId: string;
  mutationId?: string;
};
type PullRequestStep =
  "comment" | "requestReview" | "merge" | "close" | "reopen";
type PullRequestWriteBuild = (
  tx: Tx,
  pr: typeof s.codePullRequest.$inferSelect,
) => Promise<{
  kind: CodeWriteKind;
  payload: Record<string, unknown>;
  reuseInFlight?: boolean;
}>;

function defaultImportType(
  access: CodeAccess,
  projectId: string,
  labels: string[],
) {
  const enabled = new Set(
    access.roster.projectTypes
      .filter((t) => t.projectId === projectId)
      .map((t) => t.typeId),
  );
  const types = access.roster.types.filter(
    (t) => !t.archivedAt && (enabled.size === 0 || enabled.has(t.id)),
  );
  const named = (name: string) =>
    types.find((t) => t.name.toLowerCase() === name);
  const bug = labels.some((l) => /bug|defect/i.test(l))
    ? named("bug")
    : undefined;
  const pick =
    bug ??
    named("task") ??
    types.find((t) => !t.hasSpecification && t.level === typeLevels.task) ??
    types.find((t) => t.level === typeLevels.task);
  if (!pick)
    throw new DomainError(
      "validation",
      "Choose the work item type to import the issue as.",
    );
  return pick.id;
}

function describeTarget(target: CodeLinkTarget, ref: string) {
  return target === "branch"
    ? `branch ${ref}`
    : target === "commit"
      ? `commit ${ref.slice(0, 12)}`
      : `${target === "issue" ? "issue" : "pull request"} #${ref.replace(/^#/, "")}`;
}

async function findTarget(
  tx: Tx,
  organizationId: string,
  repositoryId: string,
  target: CodeLinkTarget,
  ref: string,
): Promise<{ id: string; label: string; url: string | null } | null> {
  if (target === "branch") {
    const [b] = await tx
      .select()
      .from(s.codeBranch)
      .where(
        and(
          eq(s.codeBranch.organizationId, organizationId),
          eq(s.codeBranch.repositoryId, repositoryId),
          eq(s.codeBranch.name, ref),
        ),
      );
    return b ? { id: b.id, label: b.name, url: null } : null;
  }
  if (target === "commit") {
    if (!/^[0-9a-f]{7,64}$/i.test(ref)) return null;
    const [c] = await tx
      .select()
      .from(s.codeCommit)
      .where(
        and(
          eq(s.codeCommit.organizationId, organizationId),
          eq(s.codeCommit.repositoryId, repositoryId),
          sql`${s.codeCommit.sha} like ${`${ref.toLowerCase()}%`}`,
        ),
      )
      .limit(2);
    return c ? { id: c.id, label: c.sha.slice(0, 12), url: c.webUrl } : null;
  }
  const number = Number(ref.replace(/^#/, ""));
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const table = target === "issue" ? s.codeIssue : s.codePullRequest;
  const [found] = await tx
    .select({ id: table.id, webUrl: table.webUrl, number: table.number })
    .from(table)
    .where(
      and(
        eq(table.organizationId, organizationId),
        eq(table.repositoryId, repositoryId),
        eq(table.number, number),
      ),
    );
  return found
    ? { id: found.id, label: `#${found.number}`, url: found.webUrl }
    : null;
}

async function targetLabel(
  tx: Tx,
  organizationId: string,
  link: typeof s.codeWorkLink.$inferSelect,
): Promise<{ label: string; url: string | null }> {
  if (link.target === "branch") {
    const [b] = await tx
      .select({ name: s.codeBranch.name })
      .from(s.codeBranch)
      .where(
        and(
          eq(s.codeBranch.organizationId, organizationId),
          eq(s.codeBranch.id, link.targetId),
        ),
      );
    return { label: b?.name ?? "a branch", url: null };
  }
  if (link.target === "commit") {
    const [c] = await tx
      .select({ sha: s.codeCommit.sha, webUrl: s.codeCommit.webUrl })
      .from(s.codeCommit)
      .where(
        and(
          eq(s.codeCommit.organizationId, organizationId),
          eq(s.codeCommit.id, link.targetId),
        ),
      );
    return { label: c?.sha.slice(0, 12) ?? "a commit", url: c?.webUrl ?? null };
  }
  const table = link.target === "issue" ? s.codeIssue : s.codePullRequest;
  const [found] = await tx
    .select({ number: table.number, webUrl: table.webUrl })
    .from(table)
    .where(
      and(
        eq(table.organizationId, organizationId),
        eq(table.id, link.targetId),
      ),
    );
  return {
    label: found ? `#${found.number}` : "an item",
    url: found?.webUrl ?? null,
  };
}

export type CodeService = ReturnType<typeof createCodeService>;

const credentialNoun = {
  github_app: "app's credentials",
  token: "token",
  oauth_consumer: "consumer's key and secret",
} as const;

// What the administrator who is connecting can do about a failed check. The
// host's runtime wording ("an administrator must reconnect it", "try again
// later") is for people who meet a broken connection later, not for the
// person connecting it now.
function connectError(
  error: CodeHostError,
  product: string,
  baseUrl: string,
  input: { authKind: keyof typeof credentialNoun },
) {
  const noun = credentialNoun[input.authKind];
  if (error.kind === "authentication")
    return new DomainError(
      "validation",
      `${product} rejected this ${noun}. Check that it was copied whole, has not expired or been revoked, and belongs to ${baseUrl}.`,
    );
  if (error.kind === "unavailable" && error.unreachable)
    return new DomainError(
      "validation",
      `${product} at ${baseUrl} did not answer. Check the host address (leave it empty for the cloud host) and that this Lictory server can reach it through its network and proxy.`,
    );
  return new DomainError(
    error.kind === "validation" ? "validation" : "forbidden",
    error.message,
  );
}
