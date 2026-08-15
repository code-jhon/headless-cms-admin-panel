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
 * Confirms the Realtime websocket actually opens from the browser.
 *
 * Realtime is the riskiest external dependency in the plan (PRD C), so
 * milestone 0 proves the transport works before milestone 4 relies on it.
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
