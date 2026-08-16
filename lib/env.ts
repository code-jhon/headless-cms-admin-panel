import { z } from "zod";

/**
 * Environment validation. Fails loudly at startup with an actionable
 * message instead of surfacing an opaque "fetch failed" at query time.
 *
 * Key naming: Supabase replaced the legacy JWT `anon` key with the
 * publishable key (`sb_publishable_…`); the legacy keys are deprecated at
 * the end of 2026. Both are accepted here — publishable wins if both are
 * set — so an existing .env.local keeps working.
 */
const envSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .url(
        "NEXT_PUBLIC_SUPABASE_URL must be a full URL, e.g. https://xyz.supabase.co",
      ),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  })
  .refine(
    (v) =>
      Boolean(v.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
      Boolean(v.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    {
      message:
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required (Settings → API Keys → publishable key)",
      path: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
    },
  );

export interface PublicEnv {
  url: string;
  /** Publishable key if set, otherwise the legacy anon key. */
  key: string;
  /** True when falling back to the deprecated JWT anon key. */
  usingLegacyKey: boolean;
}

let cached: PublicEnv | null = null;

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;

  // Referenced statically so Next.js can inline them in client bundles.
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });

  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  • ${i.message}`).join("\n");
    throw new Error(
      `Supabase environment is not configured.\n${details}\n\n` +
        `Copy .env.example to .env.local and fill in the values from your ` +
        `Supabase project. See docs/SUPABASE_SETUP.md.`,
    );
  }

  const publishable = parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  cached = {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    key: publishable || parsed.data.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    usingLegacyKey: !publishable,
  };
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
