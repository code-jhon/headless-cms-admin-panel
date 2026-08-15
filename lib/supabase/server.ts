import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/cms";

/**
 * Server-side Supabase client, used by Server Components, Server Actions
 * and the read API Route Handlers.
 *
 * There is no auth in this challenge (PRD §2 non-goals), so there is no
 * per-request session to thread through — a single module-level client is
 * correct here. Realtime is disabled: the server never subscribes, it only
 * writes, and Postgres broadcasts the change to clients.
 */
let client: ReturnType<typeof createClient<Database>> | null = null;

export function getServerClient() {
  if (client) return client;

  const env = getPublicEnv();
  client = createClient<Database>(
    env.url,
    env.key,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  return client;
}
