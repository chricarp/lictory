import { useParams, useRouter } from "@lictory/platform/lib/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type {
  ChatSnapshot,
  ChatSummary,
} from "@lictory/core/intelligence/chat/shared";
import { paths } from "@lictory/core/lib/paths";
import {
  ConnectivityError,
  createChat,
  isAbortError,
  responseError,
  retryableStatus,
  startVisiblePolling,
  type LittoChat,
} from "@lictory/platform/components/intelligence/chat/chat-instance";
import { answerMood } from "@lictory/platform/components/intelligence/chat/mood";

// Client state for Litto: the person's conversation list and one live client
// per open conversation. It lives outside React for the browser session.
// The list and the open conversation poll the saved snapshot while this view
// is mounted and visible. Sidebar rows read that list; they do not load
// transcripts. A run started somewhere else updates a conversation already
// loaded here the next time its snapshot is read.

type ChatsContextValue = {
  chats: ChatSummary[];
  loaded: boolean;
  listError: string | null;
  activeId: string | undefined;
  // The live conversation for an id (null until its history loads).
  chatFor: (id: string) => LittoChat | null;
  loadError: (id: string) => string | null;
  start: (text: string) => void;
  rename: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  newChat: () => void;
  // Ids whose title just arrived, for the reveal animation.
  freshTitles: Set<string>;
  unread: Set<string>;
  version: number;
};

const ChatsContext = createContext<ChatsContextValue | null>(null);
export function useChats() {
  const value = useContext(ChatsContext);
  if (!value) throw new Error("useChats requires ChatsProvider.");
  return value;
}

function readUnread(key: string): Set<string> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return new Set(
      Array.isArray(stored)
        ? stored.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

type Snapshot = {
  chats: ChatSummary[];
  loaded: boolean;
  listError: string | null;
  freshTitles: Set<string>;
  unread: Set<string>;
  // Bumped when a conversation finishes loading so consumers re-read chatFor.
  version: number;
};

class ChatStore {
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private stopPolling: (() => void) | undefined;
  private instances = new Map<string, LittoChat>();
  private loading = new Set<string>();
  private errors = new Map<string, string>();
  private query: string;
  // The conversation on screen; none while the person is on another page.
  private viewing: string | undefined;

  constructor(
    private organizationId: string,
    // Read state is a browser preference scoped to this person and workspace.
    private unreadKey: string,
  ) {
    this.query = `organizationId=${encodeURIComponent(organizationId)}`;
    this.snapshot = {
      chats: [],
      loaded: false,
      listError: null,
      freshTitles: new Set(),
      unread: readUnread(unreadKey),
      version: 0,
    };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1)
      this.stopPolling = startVisiblePolling((signal) => this.poll(signal));
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size > 0) return;
      this.stopPolling?.();
      this.stopPolling = undefined;
    };
  };
  get = () => this.snapshot;

  private set(patch: Partial<Snapshot>) {
    const unreadChanged =
      patch.unread !== undefined && patch.unread !== this.snapshot.unread;
    this.snapshot = { ...this.snapshot, ...patch };
    if (unreadChanged) {
      try {
        localStorage.setItem(
          this.unreadKey,
          JSON.stringify([...this.snapshot.unread]),
        );
      } catch {
        // Keep the indicators usable when browser storage is unavailable.
      }
    }
    for (const listener of this.listeners) listener();
  }

  private touch(id: string, patch: Partial<ChatSummary>) {
    this.set({
      chats: this.snapshot.chats.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  }

  private setUnread(id: string, unread: boolean) {
    if (this.snapshot.unread.has(id) === unread) return;
    const next = new Set(this.snapshot.unread);
    if (unread) next.add(id);
    else next.delete(id);
    this.set({ unread: next });
  }

  // Shows a conversation (or the new-chat page); returns the cleanup for
  // leaving it.
  view(id: string | undefined) {
    this.viewing = id;
    return () => {
      if (this.viewing === id) this.viewing = undefined;
    };
  }

  markViewed(id: string) {
    if (document.visibilityState === "visible") this.setUnread(id, false);
  }

  private poll = async (signal: AbortSignal) => {
    try {
      await this.refresh(signal);
    } catch (error) {
      if (signal.aborted || isAbortError(error)) return;
      this.set({
        listError:
          error instanceof Error
            ? error.message
            : "Conversations did not load.",
        loaded: true,
      });
      if (error instanceof ConnectivityError) throw error;
    }
  };

  refresh = async (signal?: AbortSignal) => {
    if (signal?.aborted) return;
    let response: Response;
    try {
      response = await fetch(`/api/intelligence/chats?${this.query}`, {
        cache: "no-store",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
          : AbortSignal.timeout(15_000),
      });
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      throw new ConnectivityError(
        error instanceof Error ? error.message : "Conversations did not load.",
      );
    }
    if (signal?.aborted) return;
    if (!response.ok) {
      const message = await responseError(response);
      if (retryableStatus(response.status))
        throw new ConnectivityError(message);
      throw new Error(message);
    }
    const body = (await response.json()) as { chats: ChatSummary[] };
    // Keep optimistic chats the server has not stored yet, and a prompt whose
    // submit has not shown up in the list.
    const known = new Set(body.chats.map((c) => c.id));
    const pending = this.snapshot.chats.filter(
      (c) => !known.has(c.id) && this.instances.has(c.id),
    );
    const previous = new Map(
      this.snapshot.chats.map((chat) => [chat.id, chat]),
    );
    const chats = body.chats.map((chat) => {
      const before = previous.get(chat.id);
      if (
        before?.version !== undefined &&
        chat.version !== undefined &&
        before.version > chat.version
      )
        return before;
      const completed =
        chat.run?.status === "completed" &&
        before &&
        (before.run?.status !== "completed" || before.run.id !== chat.run.id);
      if (
        completed &&
        (this.viewing !== chat.id || document.visibilityState !== "visible")
      )
        this.setUnread(chat.id, true);
      const live = this.instances.get(chat.id);
      if (!live?.hasUnacceptedPrompt()) return chat;
      return {
        ...chat,
        running: true,
        awaitingInput: false,
        preview: chat.preview ?? live.promptPreview(),
      };
    });
    this.set({
      chats: [...pending, ...chats],
      listError: null,
      loaded: true,
    });
  };

  private create(id: string, snapshot?: ChatSnapshot) {
    const chat = createChat({
      id,
      organizationId: this.organizationId,
      surface: "page",
      messages: snapshot?.messages ?? [],
      onTitle: (title) => {
        this.touch(id, { title });
        this.set({ freshTitles: new Set(this.snapshot.freshTitles).add(id) });
      },
      onFinish: ({ message, isAbort, isDisconnect, isError }) => {
        const asking =
          !isAbort && !isError && answerMood(message, false) === "asking";
        void this.refresh().catch(() => undefined);
        if (
          !isAbort &&
          !isDisconnect &&
          !isError &&
          !asking &&
          (this.viewing !== id || document.visibilityState !== "visible")
        )
          this.setUnread(id, true);
      },
    });
    if (snapshot) chat.hydrate(snapshot);
    this.instances.set(id, chat);
    return chat;
  }

  // Loads a conversation's saved snapshot. A client that already has it
  // reads again, so a run started on another device replaces the local view.
  open(id: string) {
    const existing = this.instances.get(id);
    if (existing) {
      void existing.refresh().catch(() => undefined);
      return;
    }
    if (this.loading.has(id)) return;
    this.loading.add(id);
    void this.load(id);
  }

  private async load(id: string) {
    try {
      const response = await fetch(
        `/api/intelligence/chats/${encodeURIComponent(id)}?${this.query}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const snapshot = (await response.json()) as ChatSnapshot;
      if (this.instances.has(id)) this.instances.get(id)!.hydrate(snapshot);
      else this.create(id, snapshot);
      this.errors.delete(id);
    } catch (error) {
      this.errors.set(
        id,
        error instanceof Error
          ? error.message
          : "This conversation did not load.",
      );
    } finally {
      this.loading.delete(id);
      this.set({ version: this.snapshot.version + 1 });
    }
  }

  chatFor = (id: string) => this.instances.get(id) ?? null;
  loadError = (id: string) => this.errors.get(id) ?? null;

  start(text: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.set({
      chats: [
        {
          id,
          title: null,
          pinned: false,
          createdAt: now,
          updatedAt: now,
          preview: text.slice(0, 160),
          awaitingInput: false,
          running: true,
        },
        ...this.snapshot.chats,
      ],
    });
    const chat = this.create(id);
    void chat.sendMessage({ text }).finally(() => {
      void this.refresh().catch(() => undefined);
    });
    return id;
  }

  async patch(id: string, body: { title?: string; pinned?: boolean }) {
    const before = this.snapshot.chats;
    this.touch(id, body);
    const response = await fetch(
      `/api/intelligence/chats/${encodeURIComponent(id)}?${this.query}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      this.set({ chats: before });
      throw new Error(await responseError(response));
    }
  }

  async remove(id: string) {
    const before = this.snapshot.chats;
    this.set({ chats: before.filter((c) => c.id !== id) });
    try {
      const chat = this.instances.get(id);
      if (chat) await chat.stop();
      const response = await fetch(
        `/api/intelligence/chats/${encodeURIComponent(id)}?${this.query}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      this.instances.delete(id);
      this.setUnread(id, false);
    } catch (error) {
      this.set({ chats: before });
      throw error;
    }
  }
}

const stores = new Map<string, ChatStore>();
function storeFor(organizationId: string, userId: string) {
  const key = `${organizationId}:${userId}`;
  let store = stores.get(key);
  if (!store) {
    store = new ChatStore(
      organizationId,
      `lictory:unread-chats:${organizationId}:${userId}`,
    );
    stores.set(key, store);
  }
  return store;
}

export function ChatsProvider({ children }: { children: ReactNode }) {
  const { organization, userId } = useWorkspace();
  const router = useRouter();
  const params = useParams<{ chat?: string }>();
  const activeId = params.chat;
  const store = storeFor(organization.id, userId);
  const { chats, loaded, listError, freshTitles, unread, version } =
    useSyncExternalStore(store.subscribe, store.get, store.get);

  useLayoutEffect(() => store.view(activeId), [store, activeId]);
  useEffect(() => {
    if (!activeId) return;
    const markViewed = () => store.markViewed(activeId);
    markViewed();
    document.addEventListener("visibilitychange", markViewed);
    return () => document.removeEventListener("visibilitychange", markViewed);
  }, [store, activeId]);
  useEffect(() => {
    if (activeId) store.open(activeId);
  }, [store, activeId]);

  const start = useCallback(
    (text: string) => {
      const id = store.start(text);
      router.push(paths.intelligenceChat(organization.slug, id));
    },
    [store, organization.slug, router],
  );
  const remove = useCallback(
    async (id: string) => {
      const removing = store.remove(id);
      if (id === activeId) router.push(paths.intelligence(organization.slug));
      await removing;
    },
    [store, activeId, organization.slug, router],
  );

  const value = useMemo<ChatsContextValue>(
    () => ({
      chats,
      loaded,
      listError,
      activeId,
      chatFor: store.chatFor,
      loadError: store.loadError,
      start,
      rename: (id, title) => store.patch(id, { title }),
      setPinned: (id, pinned) => store.patch(id, { pinned }),
      remove,
      newChat: () => router.push(paths.intelligence(organization.slug)),
      freshTitles,
      unread,
      version,
    }),
    [
      store,
      version,
      chats,
      loaded,
      listError,
      activeId,
      start,
      remove,
      router,
      organization.slug,
      freshTitles,
      unread,
    ],
  );
  return (
    <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>
  );
}
