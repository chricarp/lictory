"use client";
import type { Chat } from "@ai-sdk/react";
import { useParams, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useWorkspace } from "@lictory/platform/components/workspace/provider";
import type { ChatMessage, ChatSummary } from "@lictory/core/intelligence/chat/shared";
import { paths } from "@lictory/core/lib/paths";
import { createChat } from "@lictory/platform/components/intelligence/chat/chat-instance";

// Client state for Lictory Intelligence: the person's conversation list and
// one live `Chat` per open conversation. Chats live here, above the routes, so
// a streaming answer survives navigating between conversations.

type ChatsContextValue = {
  chats: ChatSummary[];
  loaded: boolean;
  listError: string | null;
  activeId: string | undefined;
  // The live conversation for an id (null until its history loads).
  chatFor: (id: string) => Chat<ChatMessage> | null;
  loadError: (id: string) => string | null;
  start: (text: string) => void;
  rename: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  newChat: () => void;
  // Ids whose title just arrived, for the reveal animation.
  freshTitles: Set<string>;
  version: number;
};

const ChatsContext = createContext<ChatsContextValue | null>(null);
export function useChats() {
  const value = useContext(ChatsContext);
  if (!value) throw new Error("useChats requires ChatsProvider.");
  return value;
}

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return body?.error?.message ?? `Request failed (${response.status}).`;
}

export function ChatsProvider({ children }: { children: ReactNode }) {
  const { organization } = useWorkspace();
  const router = useRouter();
  const params = useParams<{ chat?: string }>();
  const activeId = params.chat;
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [freshTitles, setFreshTitles] = useState<Set<string>>(new Set());
  // Bumped when a conversation finishes loading so consumers re-read chatFor.
  const [version, setVersion] = useState(0);
  const instances = useRef(new Map<string, Chat<ChatMessage>>());
  const loading = useRef(new Set<string>());
  const errors = useRef(new Map<string, string>());
  const orgId = organization.id;
  const query = `organizationId=${encodeURIComponent(orgId)}`;

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/intelligence/chats?${query}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { chats: ChatSummary[] };
      setChats((current) => {
        // Keep optimistic chats the server has not stored yet.
        const known = new Set(body.chats.map((c) => c.id));
        const pending = current.filter(
          (c) => !known.has(c.id) && instances.current.has(c.id),
        );
        return [...pending, ...body.chats];
      });
      setListError(null);
    } catch (error) {
      setListError(
        error instanceof Error ? error.message : "Conversations did not load.",
      );
    } finally {
      setLoaded(true);
    }
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const touch = useCallback((id: string, patch: Partial<ChatSummary>) => {
    setChats((current) =>
      current.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }, []);

  const create = useCallback(
    (id: string, messages: ChatMessage[] = []) => {
      const chat = createChat({
        id,
        organizationId: orgId,
        surface: "page",
        messages,
        onTitle: (title) => {
          touch(id, { title });
          setFreshTitles((s) => new Set(s).add(id));
        },
        onFinish: () => {
          touch(id, { updatedAt: new Date().toISOString() });
        },
      });
      instances.current.set(id, chat);
      return chat;
    },
    [orgId, touch],
  );

  // Loads a conversation's history once; `chatFor` reads it afterwards. Runs
  // from an effect, never during render, so a navigation React discards
  // cannot update state.
  useEffect(() => {
    const id = activeId;
    if (!id || instances.current.has(id) || loading.current.has(id)) return;
    loading.current.add(id);
    void (async () => {
      try {
        const response = await fetch(
          `/api/intelligence/chats/${encodeURIComponent(id)}?${query}`,
          { cache: "no-store" },
        );
        if (!response.ok) throw new Error(await readError(response));
        const body = (await response.json()) as {
          messages: ChatMessage[];
        };
        create(id, body.messages);
        errors.current.delete(id);
      } catch (error) {
        errors.current.set(
          id,
          error instanceof Error
            ? error.message
            : "This conversation did not load.",
        );
      } finally {
        loading.current.delete(id);
        setVersion((v) => v + 1);
      }
    })();
  }, [activeId, create, query]);

  const chatFor = useCallback(
    (id: string) => instances.current.get(id) ?? null,
    [],
  );

  const start = useCallback(
    (text: string) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      setChats((current) => [
        {
          id,
          title: null,
          pinned: false,
          createdAt: now,
          updatedAt: now,
          preview: text.slice(0, 160),
        },
        ...current,
      ]);
      const chat = create(id);
      void chat.sendMessage({ text }).then(() => refresh());
      router.push(paths.intelligenceChat(organization.slug, id));
    },
    [create, organization.slug, refresh, router],
  );

  const patch = useCallback(
    async (id: string, body: { title?: string; pinned?: boolean }) => {
      const before = chats;
      touch(id, body);
      const response = await fetch(
        `/api/intelligence/chats/${encodeURIComponent(id)}?${query}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        setChats(before);
        throw new Error(await readError(response));
      }
    },
    [chats, query, touch],
  );

  const remove = useCallback(
    async (id: string) => {
      const before = chats;
      setChats((current) => current.filter((c) => c.id !== id));
      void instances.current.get(id)?.stop();
      if (id === activeId) router.push(paths.intelligence(organization.slug));
      const response = await fetch(
        `/api/intelligence/chats/${encodeURIComponent(id)}?${query}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setChats(before);
        throw new Error(await readError(response));
      }
      instances.current.delete(id);
    },
    [activeId, chats, organization.slug, query, router],
  );

  const value = useMemo<ChatsContextValue>(
    () => ({
      chats,
      loaded,
      listError,
      activeId,
      chatFor,
      loadError: (id) => errors.current.get(id) ?? null,
      start,
      rename: (id, title) => patch(id, { title }),
      setPinned: (id, pinned) => patch(id, { pinned }),
      remove,
      newChat: () => router.push(paths.intelligence(organization.slug)),
      freshTitles,
      version,
    }),
    [
      version,
      chats,
      loaded,
      listError,
      activeId,
      chatFor,
      start,
      patch,
      remove,
      router,
      organization.slug,
      freshTitles,
    ],
  );
  return (
    <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>
  );
}
