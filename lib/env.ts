import { z } from "zod";

/**
 * Environment validation. Fails loudly at startup with an actionable
 * message instead of surfacing an opaque "fetch failed" at query time.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url("NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://xyz.supabase.co"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

let cached: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;

  // Referenced statically so Next.js can inline them in client bundles.
  const parsed = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  • ${i.message}`).join("\n");
    throw new Error(
      `Supabase environment is not configured.\n${details}\n\n` +
        `Copy .env.example to .env.local and fill in the values from your ` +
        `Supabase project (Settings → API).`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Non-throwing check, used by the health page to render a friendly state. */
export function isEnvConfigured(): boolean {
  try {
    getPublicEnv();
    return true;
  } catch {
    return false;
  }
}
