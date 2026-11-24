import { and, eq } from "drizzle-orm";
import * as s from "@lictory/core/db/schema";
import {
  canManageProject,
  capabilitiesOf,
  type Directory,
} from "@lictory/core/contracts/protocol";
import { DomainError } from "@lictory/core/domain/errors";
import {
  authorize,
  directory,
  isAdmin,
  type Tx,
} from "@lictory/core/domain/service";

// Who may do what with code, in domain terms. Every check runs inside the
// command's transaction; nothing a browser or agent sends is evidence.
//
// - canManageCodeHosts: organization administrators connect hosts and hold
//   their credentials.
// - canLinkRepository: a project's administrators choose which
//   repositories serve it.
// - canWorkWithCode: people who change properties of a project's work items
//   link code to them, create branches, open, comment on, review, close and
//   merge pull requests of the project's repositories. The code host's own
//   protections (required reviews, branch protection) still apply to what
//   Lictory sends, because it acts with the connection's identity.
// - Reading code needs organization membership, like work items.

export type CodeAccess = {
  userId: string;
  admin: boolean;
  roster: Directory;
};

export async function codeAccess(
  tx: Tx,
  userId: string,
  organizationId: string,
): Promise<CodeAccess> {
  const membership = await authorize(tx, userId, organizationId);
  const roster = await directory(tx, userId, organizationId);
  return { userId, admin: isAdmin(membership), roster };
}

function canManageCodeHosts(access: CodeAccess) {
  return access.admin;
}

export function requireCodeHostManager(access: CodeAccess) {
  if (!canManageCodeHosts(access))
    throw new DomainError(
      "forbidden",
      "An organization administrator must manage code host connections.",
    );
}

export function canLinkRepository(access: CodeAccess, projectId: string) {
  return canManageProject(
    access.roster,
    access.userId,
    access.admin,
    projectId,
  );
}

export function requireRepositoryLinker(access: CodeAccess, projectId: string) {
  if (!access.roster.projects.some((p) => p.id === projectId))
    throw new DomainError("not_found", "This project is unavailable.");
  if (!canLinkRepository(access, projectId))
    throw new DomainError(
      "forbidden",
      "Only this project's administrators can choose its repositories.",
    );
}

export function canWorkWithCode(access: CodeAccess, projectId: string) {
  const project = access.roster.projects.find((p) => p.id === projectId);
  return (
    !!project &&
    !project.archivedAt &&
    capabilitiesOf(access.roster.disciplines, access.userId, projectId)
      .changeProperties
  );
}

export function requireCodeWorker(
  access: CodeAccess,
  projectIds: string[],
  action: string,
) {
  if (!projectIds.length)
    throw new DomainError(
      "validation",
      "This repository serves no project yet. A project administrator must link it to a project first.",
    );
  if (!projectIds.some((id) => canWorkWithCode(access, id)))
    throw new DomainError(
      "forbidden",
      `Your disciplines cannot ${action} here: it needs “Change properties” in a project this repository serves.`,
    );
}

export async function linkedProjectIds(
  tx: Tx,
  organizationId: string,
  repositoryId: string,
) {
  return (
    await tx
      .select({ projectId: s.codeRepositoryProject.projectId })
      .from(s.codeRepositoryProject)
      .where(
        and(
          eq(s.codeRepositoryProject.organizationId, organizationId),
          eq(s.codeRepositoryProject.repositoryId, repositoryId),
        ),
      )
  ).map((r) => r.projectId);
}
