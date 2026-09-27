import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as s from "~/db/schema";

import {
  handleCandidates,
  handleProblem,
  normalizeHandle,
} from "~/lib/handles";

type Database = PostgresJsDatabase<typeof s>;

export type HandleCheck =
  | { handle: string; available: true }
  | { handle: string; available: false; reason: string };

export async function checkHandle(
  db: Database,
  userId: string,
  input: string,
): Promise<HandleCheck> {
  const handle = normalizeHandle(input);
  const problem = handleProblem(handle);
  if (problem) return { handle, available: false, reason: problem };
  const taken = await db
    .select({ id: s.user.id })
    .from(s.user)
    .where(and(eq(s.user.handle, handle), ne(s.user.id, userId)))
    .limit(1);
  return taken.length
    ? { handle, available: false, reason: "That handle is already taken." }
    : { handle, available: true };
}

// Up to `count` available handles derived from the person's name and email.
export async function suggestHandles(
  db: Database,
  user: { id: string; name: string; email: string },
  count = 3,
) {
  const candidates = handleCandidates(user.name, user.email);
  const taken = new Set(
    (
      await db
        .select({ handle: s.user.handle, id: s.user.id })
        .from(s.user)
        .where(inArray(s.user.handle, candidates))
    )
      .filter((r) => r.id !== user.id)
      .map((r) => r.handle),
  );
  return candidates.filter((h) => !taken.has(h)).slice(0, count);
}

export async function claimHandle(
  db: Database,
  userId: string,
  input: string,
): Promise<HandleCheck> {
  const check = await checkHandle(db, userId, input);
  if (!check.available) return check;
  try {
    await db
      .update(s.user)
      .set({ handle: check.handle })
      .where(eq(s.user.id, userId));
  } catch (error) {
    // Another person claimed it between the check and the write.
    if (isUniqueViolation(error))
      return {
        handle: check.handle,
        available: false,
        reason: "That handle is already taken.",
      };
    throw error;
  }
  return check;
}

function isUniqueViolation(error: unknown): boolean {
  for (
    let e = error;
    e && typeof e === "object";
    e = (e as { cause?: unknown }).cause
  )
    if ((e as { code?: string }).code === "23505") return true;
  return false;
}
