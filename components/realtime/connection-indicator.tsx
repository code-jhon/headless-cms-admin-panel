"use client";

import { useRealtime } from "@/lib/realtime/provider";
import type { ConnectionState } from "@/lib/realtime/sync-policy";

/**
 * Connection state, always visible (PRD C4).
 *
 * If a panel claims to be live, the user needs to be able to tell when it is
 * not — otherwise stale data looks like current data, which is worse than
 * having no real-time at all.
 *
 * The "Updated" flash is a keyed one-shot CSS animation rather than a state
 * flag on a timer: remounting via `key={lastSyncedAt}` restarts it, so there
 * is no effect, no `setTimeout`, and nothing to clean up.
 */

const LABELS: Record<ConnectionState, string> = {
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

const DOT: Record<ConnectionState, string> = {
  connecting: "bg-warn",
  live: "bg-ok",
  reconnecting: "bg-warn",
  offline: "bg-danger",
};

const HINT: Record<ConnectionState, string> = {
  connecting: "Opening the realtime connection…",
  live: "Changes from other clients appear here automatically.",
  reconnecting: "Lost the connection — retrying, then refetching.",
  offline: "Not receiving updates. What you see may be out of date.",
};

export function ConnectionIndicator() {
  const { connection, lastSyncedAt, resync } = useRealtime();
  const isLive = connection === "live";

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={resync}
        title={`${HINT[connection]} Click to refetch now.`}
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-surface-muted"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {isLive ? (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ok opacity-60" />
          ) : null}
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${DOT[connection]}`}
          />
        </span>

        <span className="text-[11px] font-medium text-ink-muted">
          {LABELS[connection]}
        </span>

        {lastSyncedAt !== null && isLive ? (
          <span
            key={lastSyncedAt}
            className="ml-auto text-[11px] font-medium text-ok [animation:flash-out_1.8s_ease-out_forwards]"
          >
            Updated
          </span>
        ) : null}
      </button>

      {connection === "offline" ? (
        <p className="px-1 text-[11px] leading-snug text-danger">
          Not receiving updates.
        </p>
      ) : null}
    </div>
  );
}
