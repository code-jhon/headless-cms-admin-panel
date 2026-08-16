import { describe, expect, it } from "vitest";

import {
  classifyOpenEntryEvent,
  isSchemaChange,
  nextConnectionState,
  shouldRefresh,
  shouldResyncOnTransition,
  type ChangeEvent,
  type ChangeTable,
  type ConnectionState,
} from "../sync-policy";

const ENTRY_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const LOADED_AT = "2026-08-15T10:00:00Z";
const LATER = "2026-08-15T10:05:00Z";

function event(
  table: ChangeTable,
  eventType: ChangeEvent["eventType"],
  newRow: Record<string, unknown> = {},
  oldRow: Record<string, unknown> = {},
): ChangeEvent {
  return { table, eventType, new: newRow, old: oldRow };
}

describe("nextConnectionState", () => {
  it("goes live on SUBSCRIBED", () => {
    expect(nextConnectionState("SUBSCRIBED", "connecting")).toBe("live");
    expect(nextConnectionState("SUBSCRIBED", "reconnecting")).toBe("live");
  });

  it("reports a first-attempt failure as still connecting", () => {
    // Saying "reconnecting" before ever connecting would be a lie.
    expect(nextConnectionState("CHANNEL_ERROR", "connecting")).toBe(
      "connecting",
    );
  });

  it("reports a failure after being live as reconnecting, not offline", () => {
    // supabase-js retries on its own; "offline" would be alarmist.
    expect(nextConnectionState("CHANNEL_ERROR", "live")).toBe("reconnecting");
    expect(nextConnectionState("TIMED_OUT", "live")).toBe("reconnecting");
  });

  it("reports a closed channel as offline", () => {
    expect(nextConnectionState("CLOSED", "live")).toBe("offline");
  });

  it("keeps the current state for statuses it does not know", () => {
    expect(nextConnectionState("SOMETHING_NEW", "live")).toBe("live");
  });
});

describe("shouldResyncOnTransition", () => {
  it("resyncs when coming back from a gap", () => {
    // Events were missed while disconnected, so refetch everything.
    expect(shouldResyncOnTransition("reconnecting", "live")).toBe(true);
    expect(shouldResyncOnTransition("offline", "live")).toBe(true);
  });

  it("does not resync on the first successful connection", () => {
    // The page was just server-rendered; a refetch would be wasted.
    expect(shouldResyncOnTransition("connecting", "live")).toBe(false);
  });

  it("does not resync when losing the connection", () => {
    expect(shouldResyncOnTransition("live", "reconnecting")).toBe(false);
    expect(shouldResyncOnTransition("live", "offline")).toBe(false);
  });
});

describe("shouldRefresh", () => {
  const tables: ChangeTable[] = ["entries", "fields", "schemas"];

  it.each(tables)("refreshes on any %s change", (table) => {
    expect(shouldRefresh(event(table, "INSERT"))).toBe(true);
    expect(shouldRefresh(event(table, "UPDATE"))).toBe(true);
    expect(shouldRefresh(event(table, "DELETE"))).toBe(true);
  });
});

describe("isSchemaChange", () => {
  it("is true for field and schema rows", () => {
    expect(isSchemaChange(event("fields", "UPDATE"))).toBe(true);
    expect(isSchemaChange(event("schemas", "UPDATE"))).toBe(true);
  });

  it("is false for entry rows", () => {
    expect(isSchemaChange(event("entries", "UPDATE"))).toBe(false);
  });
});

describe("classifyOpenEntryEvent", () => {
  const context = { entryId: ENTRY_ID, knownUpdatedAt: LOADED_AT };

  it("ignores changes to other entries", () => {
    const e = event("entries", "UPDATE", {
      id: OTHER_ID,
      updated_at: LATER,
    });
    expect(classifyOpenEntryEvent(e, context)).toBe("ignore");
  });

  it("ignores changes to other tables", () => {
    const e = event("fields", "UPDATE", { id: ENTRY_ID, updated_at: LATER });
    expect(classifyOpenEntryEvent(e, context)).toBe("ignore");
  });

  it("reports someone else's update", () => {
    const e = event("entries", "UPDATE", {
      id: ENTRY_ID,
      updated_at: LATER,
    });
    expect(classifyOpenEntryEvent(e, context)).toBe("changed-elsewhere");
  });

  it("ignores our own echo", () => {
    // A client's own save comes back through the same subscription. Reporting
    // "someone else changed this" about your own edit destroys trust in the
    // warning, so the token has to distinguish them.
    const e = event("entries", "UPDATE", {
      id: ENTRY_ID,
      updated_at: LOADED_AT,
    });
    expect(classifyOpenEntryEvent(e, context)).toBe("ignore");
  });

  it("reports a delete of the open entry", () => {
    // DELETE carries no new row — REPLICA IDENTITY FULL is what makes the old
    // row available to identify it.
    const e = event("entries", "DELETE", {}, { id: ENTRY_ID });
    expect(classifyOpenEntryEvent(e, context)).toBe("deleted");
  });

  it("ignores a delete of a different entry", () => {
    const e = event("entries", "DELETE", {}, { id: OTHER_ID });
    expect(classifyOpenEntryEvent(e, context)).toBe("ignore");
  });

  it("ignores an insert, which cannot be the open entry", () => {
    const e = event("entries", "INSERT", { id: ENTRY_ID, updated_at: LATER });
    expect(classifyOpenEntryEvent(e, context)).toBe("ignore");
  });

  it("ignores an update with no timestamp rather than crying wolf", () => {
    const e = event("entries", "UPDATE", { id: ENTRY_ID });
    expect(classifyOpenEntryEvent(e, context)).toBe("ignore");
  });

  it("recognises the echo of a second save against the new baseline", () => {
    // After saving, the client adopts the returned updated_at. The echo of
    // that save must then be ignored too, or every save would warn.
    const afterSave = { entryId: ENTRY_ID, knownUpdatedAt: LATER };
    const echo = event("entries", "UPDATE", {
      id: ENTRY_ID,
      updated_at: LATER,
    });
    expect(classifyOpenEntryEvent(echo, afterSave)).toBe("ignore");

    const someoneElse = event("entries", "UPDATE", {
      id: ENTRY_ID,
      updated_at: "2026-08-15T10:09:00Z",
    });
    expect(classifyOpenEntryEvent(someoneElse, afterSave)).toBe(
      "changed-elsewhere",
    );
  });
});

describe("connection state machine as a whole", () => {
  it("survives a full disconnect/reconnect cycle and resyncs once", () => {
    const transitions: Array<[string, ConnectionState]> = [
      ["SUBSCRIBED", "live"],
      ["CHANNEL_ERROR", "reconnecting"],
      ["TIMED_OUT", "reconnecting"],
      ["SUBSCRIBED", "live"],
    ];

    let state: ConnectionState = "connecting";
    let resyncs = 0;

    for (const [status, expected] of transitions) {
      const next = nextConnectionState(status, state);
      if (shouldResyncOnTransition(state, next)) resyncs += 1;
      state = next;
      expect(state).toBe(expected);
    }

    // Exactly one resync: on the recovery, not on the initial connect.
    expect(resyncs).toBe(1);
  });
});
