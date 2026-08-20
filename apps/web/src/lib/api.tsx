"use client";

import { createLictoryClient, type LictoryClient } from "@lictory/api-client";
import * as React from "react";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://api.lictory.localhost";

const ClientContext = React.createContext<LictoryClient | null>(null);

export function ApiProvider({ children }: { children: React.ReactNode }) {
  const client = React.useMemo(
    () => createLictoryClient({ baseUrl: API_URL }),
    [],
  );
  return (
    <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
  );
}

export function useApi(): LictoryClient {
  const client = React.useContext(ClientContext);
  if (!client) throw new Error("useApi must be used inside <ApiProvider>");
  return client;
}

/* -------------------------------------------------------------------------- */
/*                            Minimal query layer                             */
/* -------------------------------------------------------------------------- */

type Resource<T> = {
  data: T | undefined;
  error: Error | null;
  /** True until data for the current key has arrived. Background refreshes for
   *  an already-loaded key stay false, so polling never flashes a skeleton. */
  loading: boolean;
  initialLoading: boolean;
  refresh: () => Promise<void>;
  mutate: (next: T | ((current: T | undefined) => T)) => void;
};

/**
 * A deliberately small data layer. The app's needs are a fetch, a manual
 * refresh, optimistic local mutation and interval polling while the AI works —
 * all of which fit in a hook without pulling in a cache library.
 */
export function useResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  options: { refreshInterval?: number; enabled?: boolean } = {},
): Resource<T> {
  const { refreshInterval = 0, enabled = true } = options;

  // Data is stored alongside the key it was fetched for, so switching keys
  // never briefly renders the previous resource's data.
  const [state, setState] = React.useState<{
    key: string | null;
    data?: T;
    error: Error | null;
  }>({ key: null, error: null });
  // Callers pass inline fetchers, so the latest one is mirrored into a ref
  // after commit rather than captured in the `load` dependency list.
  const fetcherRef = React.useRef(fetcher);
  React.useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const load = React.useCallback(async () => {
    if (!key || !enabled) return;
    try {
      const result = await fetcherRef.current();
      setState({ key, data: result, error: null });
    } catch (cause) {
      setState({
        key,
        error: cause instanceof Error ? cause : new Error(String(cause)),
      });
    }
  }, [key, enabled]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (!refreshInterval || !key || !enabled) return;
    const timer = setInterval(() => void load(), refreshInterval);
    return () => clearInterval(timer);
  }, [refreshInterval, load, key, enabled]);

  const mutate = React.useCallback(
    (next: T | ((current: T | undefined) => T)) => {
      setState((current) => ({
        ...current,
        data:
          typeof next === "function"
            ? (next as (value: T | undefined) => T)(current.data)
            : next,
      }));
    },
    [],
  );

  const fresh = state.key === key;

  return {
    data: fresh ? state.data : undefined,
    error: fresh ? state.error : null,
    loading: !fresh,
    initialLoading: !fresh,
    refresh: load,
    mutate,
  };
}
