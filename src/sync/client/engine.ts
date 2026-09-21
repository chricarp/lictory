import {
  PROTOCOL,
  directorySchema,
  errorSchema,
  memberPageSchema,
  mutationSchema,
  pageSchema,
  resultSchema,
  type Command,
  type Directory,
  type Scope,
} from "../shared/protocol";
import { subscribeInvalidations } from "./hub";
import {
  IndexedPersistence,
  type Cache,
  type Persistence,
  type Queued,
} from "./persistence";
import {
  optimistic,
  reconcile,
  retryDelay,
  type Entities,
} from "./reconciliation";
export type View = {
  entities: Entities;
  directory: Directory;
  pending: Queued[];
  status: "hydrating" | "syncing" | "synced" | "offline" | "failed";
  cursor?: string;
  error?: string;
  lastSync?: number;
};
const emptyDirectory: Directory = {
  organizations: [],
  products: [],
  members: [],
  groups: [],
};
export class SyncEngine {
  private cache: Cache = { entities: {}, directory: emptyDirectory };
  private queue: Queued[] = [];
  private listeners = new Set<() => void>();
  private stopped = false;
  private generation = 0;
  private revoked = false;
  private unsubscribe?: () => void;
  private channel?: BroadcastChannel;
  private running?: Promise<void>;
  private invalidated = false;
  private status: View["status"] = "hydrating";
  private error?: string;
  private view: View = {
    entities: {},
    directory: emptyDirectory,
    pending: [],
    status: "hydrating",
  };
  readonly owner: string;
  readonly key: string;
  constructor(
    readonly userId: string,
    readonly scope: Scope,
    private persistence: Persistence = new IndexedPersistence(),
  ) {
    this.owner = `${userId}:${scope.organizationId}`;
    this.key = `${this.owner}:${scope.productId ?? "org"}:${scope.workItemId ?? "list"}`;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private emit() {
    this.view = {
      entities: optimistic(
        this.cache.entities,
        this.queue.filter((q) => !q.blocked).map((q) => q.mutation),
        this.userId,
      ),
      directory: this.cache.directory,
      pending: this.queue,
      status: this.status,
      cursor: this.cache.cursor,
      error: this.error,
      lastSync: this.cache.lastSync,
    };
    for (const listener of this.listeners) listener();
  }
  async start() {
    this.stopped = false;
    const generation = ++this.generation;
    try {
      this.cache = (await this.persistence.load(this.key)) ?? this.cache;
      this.queue = await this.persistence.queue(this.owner);
      if (this.stopped || generation !== this.generation) return;
      this.status = navigator.onLine ? "syncing" : "offline";
      this.emit();
      this.channel = new BroadcastChannel(`lictory:${this.owner}`);
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === "revoked") {
          this.cache = { entities: {}, directory: emptyDirectory };
          this.queue = [];
          this.emit();
        }
        void this.sync();
      };
      window.addEventListener("offline", this.offline);
      await this.sync();
      if (this.stopped || generation !== this.generation) return;
      this.unsubscribe = subscribeInvalidations(
        this.scope.organizationId,
        this.wake,
      );
    } catch (error) {
      this.fail(error);
    }
  }
  stop() {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.channel?.close();
    window.removeEventListener("offline", this.offline);
  }
  private wake = () => {
    void this.sync();
  };
  private offline = () => {
    this.status = "offline";
    this.emit();
  };
  private fail(error: unknown) {
    if (this.stopped) return;
    this.error =
      error instanceof Error ? error.message : "Synchronization failed.";
    this.status = navigator.onLine ? "failed" : "offline";
    this.emit();
  }
  async mutate(command: Command) {
    if (this.revoked)
      throw new Error(
        "Organization access is unavailable. Reload after signing in.",
      );
    const mutation = mutationSchema.parse({
      protocol: PROTOCOL,
      id: crypto.randomUUID(),
      organizationId: this.scope.organizationId,
      command,
    });
    const item: Queued = {
      mutation,
      enqueuedAt: Date.now(),
      attempts: 0,
      nextAttempt: 0,
      blocked: false,
    };
    await this.persistence.put(this.owner, item);
    this.queue = await this.persistence.queue(this.owner);
    this.emit();
    this.channel?.postMessage("queued");
    void this.sync();
    return mutation.id;
  }
  async retry(id: string) {
    const item = this.queue.find((q) => q.mutation.id === id);
    if (!item) return;
    await this.persistence.put(this.owner, {
      ...item,
      blocked: false,
      attempts: 0,
      nextAttempt: 0,
      error: undefined,
    });
    await this.sync();
  }
  async reset() {
    await this.persistence.remove(this.key);
    this.cache = { entities: {}, directory: emptyDirectory };
    this.emit();
    await this.sync();
  }
  async discard(id: string) {
    await this.persistence.delete(this.owner, id);
    this.queue = await this.persistence.queue(this.owner);
    this.emit();
  }
  private async read() {
    let hasMore = true;
    while (hasMore && !this.stopped) {
      const query = new URLSearchParams(
        Object.entries(this.scope).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      if (this.cache.cursor !== undefined)
        query.set("cursor", this.cache.cursor);
      const response = await fetch(`/api/sync?${query}`, { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        await this.persistence.purge(this.owner);
        if (!this.revoked) this.channel?.postMessage("revoked");
        this.revoked = true;
        this.cache = { entities: {}, directory: emptyDirectory };
        this.queue = [];
        this.emit();
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        throw new Error(
          "Access is unavailable. Sign in or select another organization.",
        );
      }
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorSchema.parse(body).error.message);
      const page = pageSchema.parse(body);
      if (this.stopped) return;
      this.cache = {
        entities: reconcile(this.cache.entities, page.changes),
        cursor: page.nextCursor,
        directory: page.directory,
        lastSync: Date.now(),
      };
      await this.persistence.save(this.key, this.cache); // data + cursor commit atomically
      hasMore = page.hasMore;
      this.emit();
    }
  }
  sync(): Promise<void> {
    if (this.stopped || this.revoked) return Promise.resolve();
    if (this.running) {
      this.invalidated = true;
      return this.running;
    }
    this.running = (
      navigator.locks
        ? navigator.locks
            .request(`lictory-queue:${this.owner}`, async () => {
              await this.cycle();
            })
            .then(() => {
              return;
            })
        : this.cycle()
    )
      .catch((error) => {
        this.fail(error);
      })
      .finally(() => {
        this.running = undefined;
        if (this.invalidated && !this.stopped) {
          this.invalidated = false;
          void this.sync();
        }
      });
    return this.running;
  }
  private async cycle() {
    if (!navigator.onLine) {
      this.offline();
      return;
    }
    this.status = "syncing";
    this.error = undefined;
    this.emit();
    await this.read();
    if (this.stopped) return;
    // IDB queue items are separate records; tabs cannot overwrite each other's work.
    this.queue = await this.persistence.queue(this.owner);
    for (const item of this.queue) {
      if (this.stopped || item.blocked || item.nextAttempt > Date.now()) break;
      try {
        const response = await fetch("/api/sync", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Sync-Attempt": String(item.attempts + 1),
          },
          body: JSON.stringify(item.mutation),
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          const error = errorSchema.parse(body).error;
          if (response.status < 500) {
            await this.persistence.put(this.owner, {
              ...item,
              blocked: true,
              error: error.message,
            });
            break;
          }
          throw new Error(error.message);
        }
        const receipt = resultSchema.parse(body);
        if (receipt.mutationId !== item.mutation.id)
          throw new Error("Unexpected mutation receipt. Retry safely.");
        // Never advance a scope checkpoint to a mutation receipt: intervening changes
        // must still be read. Reconcile before removing the optimistic overlay.
        await this.read();
        await this.persistence.delete(this.owner, item.mutation.id);
        this.channel?.postMessage("committed");
      } catch (error) {
        const attempts = item.attempts + 1;
        await this.persistence.put(this.owner, {
          ...item,
          attempts,
          nextAttempt: Date.now() + retryDelay(attempts),
          blocked: attempts >= 5,
          error:
            error instanceof Error ? error.message : "Connection interrupted.",
        });
        break;
      }
    }
    this.queue = await this.persistence.queue(this.owner);
    this.error = this.queue.find((q) => q.error)?.error;
    this.status = this.error ? "failed" : "synced";
    this.emit();
  }
}
export async function loadDirectory(organizationId?: string) {
  const response = await fetch(
    `/api/sync?directory=1${organizationId ? `&organizationId=${encodeURIComponent(organizationId)}` : ""}`,
    { cache: "no-store" },
  );
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(errorSchema.parse(data).error.message);
  return directorySchema.parse(data);
}
export async function searchMembers(
  organizationId: string,
  query: string,
  offset: number,
  limit = 20,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({
    members: "1",
    organizationId,
    q: query,
    offset: String(offset),
    limit: String(limit),
  });
  const response = await fetch(`/api/sync?${params}`, {
    cache: "no-store",
    signal,
  });
  const data: unknown = await response.json();
  if (!response.ok) throw new Error(errorSchema.parse(data).error.message);
  return memberPageSchema.parse(data);
}
