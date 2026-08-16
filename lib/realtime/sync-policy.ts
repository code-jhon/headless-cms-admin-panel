/**
 * Decisions about what a realtime event means — as pure functions.
 *
 * The subscription itself is unavoidably stateful, but *what to do* about an
 * event is not, so it lives here where it can be tested directly. The
 * component is then thin enough to read in one pass.
 */

export type ChangeTable = "schemas" | "fields" | "entries";
export type ChangeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface ChangeEvent {
  table: ChangeTable;
  eventType: ChangeEventType;
  /** The row after the change; empty for DELETE. */
  new: Record<string, unknown>;
  /** The row before the change. Populated because REPLICA IDENTITY is FULL. */
  old: Record<string, unknown>;
}

/* ------------------------------------------------------- connection state */

/**
 * What the user is told about the connection.
 *
 * `reconnecting` is distinct from `offline` on purpose: supabase-js retries
 * on its own, so a channel error is usually transient and telling someone
 * they are disconnected would be alarmist.
 */
export type ConnectionState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline";

/** supabase-js channel status → what we display. */
export function nextConnectionState(
  status: string,
  previous: ConnectionState,
): ConnectionState {
  switch (status) {
    case "SUBSCRIBED":
      return "live";
    case "CHANNEL_ERROR":
    case "TIMED_OUT":
      // Once we have been live, a blip is a reconnection, not a cold start.
      return previous === "connecting" ? "connecting" : "reconnecting";
    case "CLOSED":
      return "offline";
    default:
      return previous;
  }
}

/**
 * Coming back from a gap means the client missed events.
 *
 * Rather than trying to replay them, the client refetches everything — the
 * database is the single source of truth, so a full resync is both simpler
 * and impossible to get subtly wrong (PRD C4).
 */
export function shouldResyncOnTransition(
  from: ConnectionState,
  to: ConnectionState,
): boolean {
  return to === "live" && (from === "reconnecting" || from === "offline");
}

/* ------------------------------------------------------------- refreshing */

/**
 * Every content change invalidates what is on screen somewhere: entries feed
 * the lists and editors, schemas and fields feed the sidebar, the generated
 * form and the read API panel. So any of the three warrants a refetch.
 *
 * The events carry *what changed*, never the new state — the refetch does
 * that. Patching client state from the payload is how clients drift.
 */
export function shouldRefresh(event: ChangeEvent): boolean {
  return (
    event.table === "entries" ||
    event.table === "fields" ||
    event.table === "schemas"
  );
}

/**
 * True when the schema definition itself moved, which means an open entry
 * form is now generated from a stale definition (PRD C2).
 */
export function isSchemaChange(event: ChangeEvent): boolean {
  return event.table === "fields" || event.table === "schemas";
}

/* --------------------------------------------------- open-entry conflicts */

export interface OpenEntryContext {
  entryId: string;
  /**
   * The `updated_at` this client last knows itself to have written or loaded.
   * An event carrying this exact value is our own echo.
   */
  knownUpdatedAt: string;
}

export type OpenEntryVerdict = "ignore" | "changed-elsewhere" | "deleted";

/**
 * Decide what an event means for the entry currently open in the editor.
 *
 * Self-echo suppression matters: a client's own save comes back through the
 * same subscription, and reporting "someone else changed this" about your own
 * edit destroys trust in the warning.
 */
export function classifyOpenEntryEvent(
  event: ChangeEvent,
  context: OpenEntryContext,
): OpenEntryVerdict {
  if (event.table !== "entries") return "ignore";

  const rowId = (event.new.id ?? event.old.id) as string | undefined;
  if (rowId !== context.entryId) return "ignore";

  if (event.eventType === "DELETE") return "deleted";
  if (event.eventType !== "UPDATE") return "ignore";

  const incoming = event.new.updated_at as string | undefined;
  if (!incoming || incoming === context.knownUpdatedAt) return "ignore";

  return "changed-elsewhere";
}

/* ------------------------------------------------------------- coalescing */

/**
 * How long to wait before refetching after an event.
 *
 * A schema migration touches every entry of a type, which would otherwise
 * mean one refetch per row. Waiting briefly turns a burst into a single
 * refresh, at the cost of a delay no one perceives.
 */
export const REFRESH_DEBOUNCE_MS = 250;
