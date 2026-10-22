import { z } from "zod";
import {
  checkpointSchema,
  directorySchema,
  entitySchema,
  mutationSchema,
} from "@lictory/core/contracts/protocol";
export const queuedSchema = z.object({
  mutation: mutationSchema,
  enqueuedAt: z.number(),
  attempts: z.number(),
  nextAttempt: z.number(),
  error: z.string().optional(),
  blocked: z.boolean(),
  forgettable: z.boolean().optional(),
  uncertain: z.boolean().optional(),
});
export type Queued = z.infer<typeof queuedSchema>;
// Legacy entries with retries also have an uncertain server outcome.
export function applicationRejected(item: Queued) {
  return item.blocked && item.attempts === 0 && !item.uncertain;
}
export function forgettable(item: Queued) {
  return item.forgettable ?? item.mutation.command.type === "updateWorkItem";
}
export const cacheSchema = z.object({
  cursor: checkpointSchema.optional(),
  entities: z.record(z.string(), entitySchema),
  directory: directorySchema,
  lastSync: z.number().optional(),
});
export type Cache = z.infer<typeof cacheSchema>;
export interface Persistence {
  load(key: string): Promise<Cache | undefined>;
  save(key: string, cache: Cache): Promise<void>;
  remove(key: string): Promise<void>;
  purge(owner: string): Promise<void>;
  queue(owner: string): Promise<Queued[]>;
  put(owner: string, item: Queued): Promise<void>;
  delete(owner: string, id: string): Promise<void>;
}
export class IndexedPersistence implements Persistence {
  private connection?: Promise<IDBDatabase>;
  private open() {
    return (this.connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("lictory-sync-v2", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("cache");
        request.result.createObjectStore("queue", { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            "Browser storage is unavailable. Enable IndexedDB to save work.",
          ),
        );
    }));
  }
  private async transaction<T>(
    store: string,
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () =>
        reject(tx.error ?? new Error("Local persistence failed."));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Local persistence was interrupted."));
    });
  }
  async load(key: string) {
    const raw: unknown = await this.transaction("cache", "readonly", (s) =>
      s.get(key),
    );
    // A cache written by an older protocol simply causes a fresh bootstrap.
    const parsed = cacheSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }
  async save(key: string, cache: Cache) {
    await this.transaction("cache", "readwrite", (s) => s.put(cache, key));
  }
  async remove(key: string) {
    await this.transaction("cache", "readwrite", (s) => s.delete(key));
  }
  async purge(owner: string) {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["cache", "queue"], "readwrite");
      for (const storeName of ["cache", "queue"]) {
        const store = tx.objectStore(storeName);
        const request = store.openCursor(
          IDBKeyRange.bound(`${owner}:`, `${owner}:\uffff`),
        );
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(
          tx.error ?? new Error("Could not clear revoked workspace data."),
        );
    });
  }
  async queue(owner: string) {
    const raw: unknown = await this.transaction("queue", "readonly", (s) =>
      s.getAll(),
    );
    return z
      .array(z.object({ owner: z.string(), item: queuedSchema }))
      .parse(raw)
      .filter((r) => r.owner === owner)
      .map((r) => r.item)
      .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  }
  async put(owner: string, item: Queued) {
    await this.transaction("queue", "readwrite", (s) =>
      s.put({ key: `${owner}:${item.mutation.id}`, owner, item }),
    );
  }
  async delete(owner: string, id: string) {
    await this.transaction("queue", "readwrite", (s) =>
      s.delete(`${owner}:${id}`),
    );
  }
}
