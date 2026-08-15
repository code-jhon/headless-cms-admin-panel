"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getBrowserClient } from "@/lib/supabase/client";
import {
  REFRESH_DEBOUNCE_MS,
  nextConnectionState,
  shouldRefresh,
  shouldResyncOnTransition,
  type ChangeEvent,
  type ChangeTable,
  type ConnectionState,
} from "./sync-policy";

/**
 * One realtime subscription for the whole admin panel.
 *
 * Design, in one line: **events say what changed, the server says what it
 * now is.** An event triggers `router.refresh()`, which refetches the Server
 * Components; nothing patches client state from the payload. That is slightly
 * chattier than applying diffs locally and completely removes the class of
 * bug where a client's copy silently drifts from the database.
 *
 * `router.refresh()` preserves client state, so an open form keeps its
 * values while the data behind it updates.
 */

type ClientResult =
  | { ok: true; client: ReturnType<typeof getBrowserClient> }
  | { ok: false };

/** Resolved once, lazily: a missing config must not throw during render. */
function resolveClient(): ClientResult {
  try {
    return { ok: true, client: getBrowserClient() };
  } catch {
    return { ok: false };
  }
}

interface RealtimeContextValue {
  connection: ConnectionState;
  /** Bumps on every completed refresh — for "just updated" affordances. */
  lastSyncedAt: number | null;
  /** Register a listener for raw change events. Returns an unsubscribe fn. */
  subscribe: (listener: (event: ChangeEvent) => void) => () => void;
  /** Force a refetch, e.g. from a "reload" button. */
  resync: () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

const TABLES: ChangeTable[] = ["schemas", "fields", "entries"];

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const [clientResult] = useState<ClientResult>(resolveClient);
  // No credentials — the health page explains it; the panel still renders
  // whatever the server produced, just without live updates.
  const [connection, setConnection] = useState<ConnectionState>(() =>
    clientResult.ok ? "connecting" : "offline",
  );
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const listeners = useRef(new Set<(event: ChangeEvent) => void>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref as well as state: the subscribe callback closes over its
  // first render, so reading `connection` there would always see "connecting".
  const connectionRef = useRef<ConnectionState>(connection);

  const runRefresh = useCallback(() => {
    router.refresh();
    setLastSyncedAt(Date.now());
  }, [router]);

  /** Coalesce a burst of events into one refetch. */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(runRefresh, REFRESH_DEBOUNCE_MS);
  }, [runRefresh]);

  const applyConnection = useCallback(
    (next: ConnectionState) => {
      const previous = connectionRef.current;
      if (next === previous) return;

      connectionRef.current = next;
      setConnection(next);

      // Coming back from a gap means events were missed. Refetch rather than
      // trying to replay them.
      if (shouldResyncOnTransition(previous, next)) runRefresh();
    },
    [runRefresh],
  );

  useEffect(() => {
    if (!clientResult.ok) return;
    const { client } = clientResult;

    const channel = client.channel("cms-admin");

    for (const table of TABLES) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          const event: ChangeEvent = {
            table,
            eventType: payload.eventType as ChangeEvent["eventType"],
            new: (payload.new ?? {}) as Record<string, unknown>,
            old: (payload.old ?? {}) as Record<string, unknown>,
          };

          for (const listener of listeners.current) listener(event);
          if (shouldRefresh(event)) scheduleRefresh();
        },
      );
    }

    channel.subscribe((status) => {
      applyConnection(nextConnectionState(status, connectionRef.current));
    });

    // The websocket can stay open while the network is gone; the browser's
    // own signals catch what the channel status misses.
    const handleOffline = () => applyConnection("offline");
    const handleOnline = () => applyConnection("reconnecting");
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void client.removeChannel(channel);
    };
  }, [applyConnection, clientResult, scheduleRefresh]);

  const subscribe = useCallback((listener: (event: ChangeEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<RealtimeContextValue>(
    () => ({ connection, lastSyncedAt, subscribe, resync: runRefresh }),
    [connection, lastSyncedAt, subscribe, runRefresh],
  );

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error("useRealtime must be used inside <RealtimeProvider>");
  }
  return context;
}

/**
 * Subscribe to raw change events.
 *
 * The listener is kept in a ref so callers do not have to memoise it — a
 * fresh closure every render would otherwise resubscribe on every render.
 */
export function useRealtimeEvents(listener: (event: ChangeEvent) => void) {
  const { subscribe } = useRealtime();
  const ref = useRef(listener);

  // Assigned after render, not during it: writing a ref while rendering is
  // unsafe under concurrent rendering.
  useEffect(() => {
    ref.current = listener;
  });

  useEffect(() => subscribe((event) => ref.current(event)), [subscribe]);
}
