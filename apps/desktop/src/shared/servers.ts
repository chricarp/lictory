import { isInAppPath, originOf } from "./urls";

// The servers a person added, in the order of the server switcher. The file
// holds addresses and view preferences only: sign-ins live in each server's
// own browser session (its partition), never here.

export type Server = {
  // Random; also names the server's persistent session partition, so
  // removing and adding a server again starts signed out.
  id: string;
  origin: string;
  name: string;
  addedAt: string;
  // The last in-app path, reopened on the next launch.
  lastPath: string | null;
  zoomLevel: number;
};

export type ServersState = {
  servers: Server[];
  activeId: string | null;
};

export const MAX_SERVERS = 30;
const MAX_NAME = 60;

export const emptyServers: ServersState = { servers: [], activeId: null };

export function partitionFor(server: Pick<Server, "id">) {
  return `persist:server-${server.id}`;
}

export function defaultServerName(origin: string) {
  return new URL(origin).host;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const clampZoom = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(-3, Math.min(5, value))
    : 0;

// Reads the stored file, keeping every valid entry of a damaged one.
export function normalizeServers(raw: unknown): ServersState {
  if (!isRecord(raw) || !Array.isArray(raw.servers)) return emptyServers;
  const servers: Server[] = [];
  const ids = new Set<string>();
  const origins = new Set<string>();
  for (const entry of raw.servers) {
    if (!isRecord(entry)) continue;
    const id = typeof entry.id === "string" ? entry.id : "";
    const origin =
      typeof entry.origin === "string" ? originOf(entry.origin) : null;
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(id) || !origin) continue;
    if (ids.has(id) || origins.has(origin)) continue;
    ids.add(id);
    origins.add(origin);
    servers.push({
      id,
      origin,
      name:
        typeof entry.name === "string" && entry.name.trim()
          ? entry.name.trim().slice(0, MAX_NAME)
          : defaultServerName(origin),
      addedAt:
        typeof entry.addedAt === "string"
          ? entry.addedAt
          : new Date(0).toISOString(),
      lastPath: isInAppPath(entry.lastPath) ? entry.lastPath : null,
      zoomLevel: clampZoom(entry.zoomLevel),
    });
    if (servers.length === MAX_SERVERS) break;
  }
  const activeId =
    typeof raw.activeId === "string" && ids.has(raw.activeId)
      ? raw.activeId
      : (servers[0]?.id ?? null);
  return { servers, activeId };
}

export function findByOrigin(state: ServersState, origin: string) {
  return state.servers.find((s) => s.origin === origin);
}

// Adds a server and selects it. An origin already present is selected
// instead of being added twice.
export function addServer(
  state: ServersState,
  input: { id: string; origin: string; name?: string; now: Date },
): { state: ServersState; server: Server; added: boolean } {
  const existing = findByOrigin(state, input.origin);
  if (existing)
    return {
      state: { ...state, activeId: existing.id },
      server: existing,
      added: false,
    };
  if (state.servers.length >= MAX_SERVERS)
    throw new Error(
      `Lictory can keep up to ${MAX_SERVERS} servers. Remove one to add another.`,
    );
  const name = input.name?.trim().slice(0, MAX_NAME);
  const server: Server = {
    id: input.id,
    origin: input.origin,
    name:
      name === undefined || name === ""
        ? defaultServerName(input.origin)
        : name,
    addedAt: input.now.toISOString(),
    lastPath: null,
    zoomLevel: 0,
  };
  return {
    state: { servers: [...state.servers, server], activeId: server.id },
    server,
    added: true,
  };
}

// Removing the active server selects its neighbour.
export function removeServer(state: ServersState, id: string): ServersState {
  const index = state.servers.findIndex((s) => s.id === id);
  if (index < 0) return state;
  const servers = state.servers.filter((s) => s.id !== id);
  const activeId =
    state.activeId === id
      ? (servers[Math.min(index, servers.length - 1)]?.id ?? null)
      : state.activeId;
  return { servers, activeId };
}

export function selectServer(state: ServersState, id: string): ServersState {
  return state.servers.some((s) => s.id === id)
    ? { ...state, activeId: id }
    : state;
}

export function moveServer(
  state: ServersState,
  id: string,
  offset: number,
): ServersState {
  const from = state.servers.findIndex((s) => s.id === id);
  if (from < 0) return state;
  const to = Math.max(0, Math.min(state.servers.length - 1, from + offset));
  if (to === from) return state;
  const servers = [...state.servers];
  const [moved] = servers.splice(from, 1);
  if (moved) servers.splice(to, 0, moved);
  return { ...state, servers };
}

export function updateServer(
  state: ServersState,
  id: string,
  patch: Partial<Pick<Server, "name" | "lastPath" | "zoomLevel">>,
): ServersState {
  return {
    ...state,
    servers: state.servers.map((s) =>
      s.id === id
        ? {
            ...s,
            ...(patch.name !== undefined
              ? {
                  name:
                    patch.name.trim().slice(0, MAX_NAME) ||
                    defaultServerName(s.origin),
                }
              : {}),
            ...(patch.lastPath !== undefined
              ? {
                  lastPath: isInAppPath(patch.lastPath) ? patch.lastPath : null,
                }
              : {}),
            ...(patch.zoomLevel !== undefined
              ? { zoomLevel: clampZoom(patch.zoomLevel) }
              : {}),
          }
        : s,
    ),
  };
}

// ⌘1…⌘9 (Ctrl on Windows and Linux) open the server at that position in the
// switcher, as in Slack.
export function serverForShortcut(
  state: ServersState,
  digit: number,
): Server | undefined {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return undefined;
  return state.servers[digit - 1];
}

// Two letters for the switcher: the first letters of the name's first two
// words, or its first two letters.
export function initials(name: string): string {
  const words = name
    .replace(/^https?:\/\//, "")
    .split(/[\s.\-_:]+/)
    .filter(Boolean);
  const first = words[0] ?? "?";
  const second = words[1];
  const letters =
    second &&
    /^[a-z]/i.test(second) &&
    !/^(com|org|net|io|dev|app|local|localhost)$/i.test(second)
      ? `${first[0]}${second[0]}`
      : first.slice(0, 2);
  return letters.toUpperCase();
}
