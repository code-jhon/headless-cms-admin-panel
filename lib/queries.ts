import "server-only";

import { getServerClient } from "@/lib/supabase/server";
import { isEnvConfigured } from "@/lib/env";
import type { ContentSchema } from "@/types/cms";

export interface Result<T> {
  data: T;
  error: string | null;
}

/**
 * Schema list for the sidebar.
 *
 * Returns a Result rather than throwing: the shell must still render when
 * Supabase is unconfigured, so a first-run user sees the health check
 * instead of a Next.js error overlay.
 */
export async function listSchemas(): Promise<Result<ContentSchema[]>> {
  if (!isEnvConfigured()) {
    return { data: [], error: "Supabase environment is not configured." };
  }

  const { data, error } = await getServerClient()
    .from("schemas")
    .select("*")
    .order("name", { ascending: true });

  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}
