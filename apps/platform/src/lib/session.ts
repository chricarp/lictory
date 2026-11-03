import { useSyncExternalStore } from "react";
import { z } from "zod";

// The signed-in person, read once at boot from GET /api/session and again
// after anything changes the account (sign-in, handle, profile, sign-out).
// Workspace data never comes from here: it is synchronized by Zero.

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable().optional(),
  handle: z.string().nullable().optional(),
  appearance: z.string().nullable().optional(),
  theme: z.string().nullable().optional(),
  twoFactorEnabled: z.boolean().optional(),
});
const heldSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
const noProviders = { google: false, microsoft: false, oidc: false };
// How people sign in on this installation (password, company SSO name).
const defaultSignIn = { password: true, ssoName: null };
const sessionSchema = z.object({
  user: userSchema.nullable(),
  // Organizations that require two-factor authentication this person has
  // not turned on yet. The server refuses their data either way.
  twoFactorRequiredBy: z.array(heldSchema).default([]),
  providers: z
    .object({
      google: z.boolean(),
      microsoft: z.boolean(),
      oidc: z.boolean().default(false),
    })
    .default(noProviders),
  signIn: z
    .object({ password: z.boolean(), ssoName: z.string().nullable() })
    .default(defaultSignIn),
  // Whether the server has object storage for attachments.
  attachments: z.boolean().default(true),
});

export type SessionUser = z.infer<typeof userSchema>;
export type AuthProviders = z.infer<typeof sessionSchema>["providers"];
export type SignInOptions = z.infer<typeof sessionSchema>["signIn"];
export type Session = {
  user: SessionUser | null;
  providers: AuthProviders;
  twoFactorRequiredBy: z.infer<typeof heldSchema>[];
  signIn: SignInOptions;
  attachments: boolean;
};

type State =
  | { status: "loading"; session?: undefined; error?: undefined }
  | { status: "ready"; session: Session; error?: undefined }
  | { status: "error"; session?: Session; error: string };

let state: State = { status: "loading" };
let inflight: Promise<Session> | undefined;
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

async function fetchSession(): Promise<Session> {
  const response = await fetch("/api/session", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(
      `Your session could not be checked (HTTP ${response.status}). Reload to try again.`,
    );
  return sessionSchema.parse(await response.json());
}

// Resolves the current session, reusing a request already in flight. `force`
// reads again from the server (after a sign-in or account change).
export function loadSession(force = false): Promise<Session> {
  if (!force && state.status === "ready") return Promise.resolve(state.session);
  if (inflight) return inflight;
  inflight = fetchSession()
    .then((session) => {
      set({ status: "ready", session });
      return session;
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error
          ? error.message
          : "Your session could not be checked.";
      set({ status: "error", session: state.session, error: message });
      throw error;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

export const refreshSession = () => loadSession(true);

// Forgets the session locally (after signing out) without a request.
export function clearSession() {
  set({
    status: "ready",
    session: {
      user: null,
      providers: state.session?.providers ?? noProviders,
      signIn: state.session?.signIn ?? defaultSignIn,
      twoFactorRequiredBy: [],
      attachments: state.session?.attachments ?? true,
    },
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const snapshot = () => state;

export function useSessionState() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// For components rendered inside the signed-in layout.
export function useSessionUser(): SessionUser {
  const current = useSessionState();
  const user = current.session?.user;
  if (!user) throw new Error("useSessionUser requires a signed-in session.");
  return user;
}

export function useAuthProviders(): AuthProviders {
  return useSessionState().session?.providers ?? noProviders;
}

export function useSignInOptions(): SignInOptions {
  return useSessionState().session?.signIn ?? defaultSignIn;
}

// Organizations holding the signed-in person until they turn on two-factor.
export function useTwoFactorRequiredBy() {
  return useSessionState().session?.twoFactorRequiredBy ?? [];
}

// False when the server has no file storage: uploads are not offered.
export function useAttachmentsAvailable(): boolean {
  return useSessionState().session?.attachments ?? true;
}
