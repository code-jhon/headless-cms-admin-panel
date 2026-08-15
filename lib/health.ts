import "server-only";

import { getServerClient } from "@/lib/supabase/server";
import { getPublicEnv, isEnvConfigured } from "@/lib/env";

export type CheckStatus = "ok" | "warn" | "fail";

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  /** Shown when the check is not ok — what the user should do next. */
  fix?: string;
}

/**
 * Milestone 0 acceptance: does the app actually reach the database, and is
 * every table from 0001_init.sql present and readable?
 *
 * Each check reports its own fix so a first-run user is never left guessing.
 */
export async function runHealthChecks(): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  if (!isEnvConfigured()) {
    return [
      {
        name: "Environment",
        status: "fail",
        detail:
          "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing.",
        fix: "Copy .env.example to .env.local, fill in the Project URL (Settings → Data API) and the publishable key (Settings → API Keys), then restart the dev server. See docs/SUPABASE_SETUP.md.",
      },
      {
        name: "Database connection",
        status: "fail",
        detail: "Skipped — no credentials to connect with.",
      },
    ];
  }

  const env = getPublicEnv();
  checks.push(
    env.usingLegacyKey
      ? {
          name: "Environment",
          status: "warn",
          detail: "Using the legacy JWT `anon` key.",
          fix: "Supabase retires legacy keys at the end of 2026. Switch to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (Settings → API Keys).",
        }
      : {
          name: "Environment",
          status: "ok",
          detail: "Project URL and publishable key are set.",
        },
  );

  const db = getServerClient();
  const tables = ["schemas", "fields", "entries"] as const;
  let reachable = true;

  for (const table of tables) {
    const { count, error } = await db
      .from(table)
      .select("id", { count: "exact", head: true });

    if (error) {
      reachable = false;
      checks.push({
        name: `Table: ${table}`,
        status: "fail",
        detail: error.message,
        fix: explainTableError(error.message),
      });
      continue;
    }

    checks.push({
      name: `Table: ${table}`,
      status: "ok",
      detail: `Readable — ${count ?? 0} row${count === 1 ? "" : "s"}.`,
    });
  }

  if (reachable) {
    const { count } = await db
      .from("schemas")
      .select("id", { count: "exact", head: true });

    checks.push(
      count && count > 0
        ? {
            name: "Seed data",
            status: "ok",
            detail: `${count} content type${count === 1 ? "" : "s"} defined.`,
          }
        : {
            name: "Seed data",
            status: "warn",
            detail: "No content types yet.",
            fix: "Run `npm run seed` to create the Person and Article example types.",
          },
    );
  }

  return checks;
}

/** Turns a Postgrest/network error into the one action that resolves it. */
function explainTableError(message: string): string {
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(message)) {
    return "Could not reach the Supabase host. Check NEXT_PUBLIC_SUPABASE_URL in .env.local, and that the project is not paused.";
  }
  if (/does not exist|schema cache|relation/i.test(message)) {
    return "The table is missing. Run supabase/migrations/0001_init.sql in your Supabase project's SQL Editor.";
  }
  if (/JWT|api key|invalid|401|403/i.test(message)) {
    return "The key was rejected. Re-copy the publishable key from Settings → API Keys.";
  }
  if (/permission|policy|RLS/i.test(message)) {
    return "Blocked by row-level security. Re-run the policy statements at the end of 0001_init.sql.";
  }
  return "Re-run supabase/migrations/0001_init.sql, then reload this page.";
}
