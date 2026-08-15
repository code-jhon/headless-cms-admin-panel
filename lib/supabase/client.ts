"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/types/cms";

/**
 * Browser Supabase client — one instance per tab.
 *
 * This is also the Realtime transport (PRD C): subscriptions are opened
 * against this same client so a single websocket carries every channel.
 */
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getBrowserClient() {
  if (client) return client;

  const env = getPublicEnv();
  client = createBrowserClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      realtime: {
        // Cap the event rate so a bulk schema migration cannot flood clients.
        params: { eventsPerSecond: 20 },
      },
    },
  );

  return client;
}
