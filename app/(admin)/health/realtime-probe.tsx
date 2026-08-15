"use client";

import { useEffect, useState } from "react";

import { getBrowserClient } from "@/lib/supabase/client";

type ProbeState = "connecting" | "connected" | "error";

type ClientResult =
  | { ok: true; client: ReturnType<typeof getBrowserClient> }
  | { ok: false; message: string };

/** Resolved once, lazily, so a missing env never throws during render. */
function resolveClient(): ClientResult {
  try {
    return { ok: true, client: getBrowserClient() };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Client unavailable.",
    };
  }
}

/**
 * Is the realtime endpoint reachable only from the machine running the app?
 *
 * This is the trap when opening the panel from a second device: a `localhost`
 * endpoint resolves to *that* device, not to the one serving the app, so the
 * websocket has nothing to connect to. Worth naming explicitly, because the
 * browser only reports "WebSocket connection failed".
 */
function isMachineLocal(endpoint: string): boolean {
  return /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(endpoint);
}

/**
 * Confirms the Realtime websocket actually opens from the browser.
 *
 * Realtime is the riskiest external dependency in the plan (PRD C), and the
 * one whose failures are least legible — so this shows the exact endpoint it
 * dialled, which is the first thing anyone debugging needs to know.
 */
export function RealtimeProbe() {
  const [resolved] = useState<ClientResult>(resolveClient);
  const [state, setState] = useState<ProbeState>(() =>
    resolved.ok ? "connecting" : "error",
  );
  const [detail, setDetail] = useState(() =>
    resolved.ok ? "Opening websocket…" : resolved.message,
  );
  const [events, setEvents] = useState(0);

  // The URL the websocket actually dials, minus the query string (which
  // carries the API key).
  const [endpoint] = useState(() => {
    if (!resolved.ok) return null;
    try {
      return resolved.client.realtime.endPoint ?? null;
    } catch {
      return null;
    }
  });

  const [origin] = useState(() =>
    typeof window === "undefined" ? null : window.location.origin,
  );

  const localOnly = endpoint ? isMachineLocal(endpoint) : false;

  useEffect(() => {
    if (!resolved.ok) return;
    const { client } = resolved;

    const channel = client
      .channel("health-probe")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "entries" },
        () => setEvents((n) => n + 1),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setState("connected");
          setDetail("Subscribed to changes on public.entries.");
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setState("error");
          setDetail(
            "Could not subscribe. Check that Realtime is enabled for the table " +
              "(0001_init.sql adds it to the supabase_realtime publication).",
          );
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [resolved]);

  const styles: Record<ProbeState, string> = {
    connecting: "bg-warn-soft text-warn",
    connected: "bg-ok-soft text-ok",
    error: "bg-danger-soft text-danger",
  };
  const label: Record<ProbeState, string> = {
    connecting: "Connecting",
    connected: "Connected",
    error: "Failed",
  };

  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Realtime (browser)</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[state]}`}
        >
          {label[state]}
        </span>
      </div>

      <p className="mt-2 text-sm text-ink-muted">{detail}</p>

      {endpoint ? (
        <dl className="mt-3 space-y-1 rounded bg-surface-muted px-3 py-2 text-xs">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-ink-muted">Websocket</dt>
            <dd className="min-w-0 break-all font-mono text-ink">{endpoint}</dd>
          </div>
          {origin ? (
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-ink-muted">Page origin</dt>
              <dd className="min-w-0 break-all font-mono text-ink">{origin}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {/* The cross-machine trap: a localhost endpoint works on the machine
          running the app and nowhere else. */}
      {localOnly ? (
        <div className="mt-3 rounded border border-border-subtle bg-warn-soft px-3 py-2 text-xs text-ink-muted">
          <p className="font-medium text-warn">
            This endpoint only works on this machine
          </p>
          <p className="mt-1">
            <code className="font-mono">localhost</code> means &ldquo;the device
            running the browser&rdquo;, so another device on your network cannot
            reach it. Point{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> at
            something both machines can resolve — your hosted Supabase project,
            or this machine&rsquo;s LAN IP — then restart the dev server.
          </p>
        </div>
      ) : null}

      {state === "connected" ? (
        <p className="mt-2 text-xs text-ink-muted">
          {events === 0
            ? "Waiting for a change — run `npm run seed -- --reset` in another terminal to see this tick."
            : `${events} change event${events === 1 ? "" : "s"} received.`}
        </p>
      ) : null}
    </section>
  );
}
