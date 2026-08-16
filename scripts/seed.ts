/**
 * Seed script — creates two related schemas and a handful of entries so the
 * app has something to show before the Schema Builder (milestone 1) exists.
 *
 *   npm run seed          # insert, skip anything already present
 *   npm run seed -- --reset   # delete the demo schemas first, then insert
 *
 * Deliberately idempotent: running it twice does not duplicate content.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

import type { Database, Entry, FieldType } from "../types/cms";

config({ path: ".env.local" });
config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// Publishable key preferred; legacy anon key accepted until it is retired.
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    "\n  Missing Supabase credentials.\n" +
      "  Copy .env.example to .env.local, fill in NEXT_PUBLIC_SUPABASE_URL and\n" +
      "  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then re-run.\n" +
      "  Walkthrough: docs/SUPABASE_SETUP.md\n",
  );
  process.exit(1);
}

const db = createClient<Database>(url, key, {
  auth: { persistSession: false },
});

const reset = process.argv.includes("--reset");

type SeedField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  target?: string; // api_id of the target schema, for references
};

const SEED: Array<{
  api_id: string;
  name: string;
  description: string;
  fields: SeedField[];
  entries: Array<Record<string, unknown>>;
}> = [
  {
    api_id: "person",
    name: "Person",
    description: "An author or contributor.",
    fields: [
      { key: "full_name", label: "Full name", type: "text", required: true },
      { key: "email", label: "Email", type: "text" },
      { key: "active", label: "Active", type: "boolean" },
    ],
    entries: [
      { full_name: "Ada Lovelace", email: "ada@example.com", active: true },
      { full_name: "Grace Hopper", email: "grace@example.com", active: true },
      { full_name: "Alan Turing", email: "alan@example.com", active: false },
    ],
  },
  {
    api_id: "article",
    name: "Article",
    description: "A piece of written content.",
    fields: [
      { key: "title", label: "Title", type: "text", required: true },
      { key: "body", label: "Body", type: "text" },
      { key: "read_time", label: "Read time (min)", type: "number" },
      { key: "published_at", label: "Published at", type: "date" },
      { key: "featured", label: "Featured", type: "boolean" },
      { key: "author", label: "Author", type: "reference", target: "person" },
    ],
    entries: [
      {
        title: "Notes on the Analytical Engine",
        body: "The engine weaves algebraic patterns.",
        read_time: 7,
        published_at: "1843-10-01",
        featured: true,
      },
      {
        title: "On Compilers",
        body: "A program that writes programs.",
        read_time: 4,
        published_at: "1952-05-12",
        featured: false,
      },
    ],
  },
];

async function main() {
  if (reset) {
    const apiIds = SEED.map((s) => s.api_id);
    // Reverse order so referencing schemas go before their targets.
    for (const api_id of [...apiIds].reverse()) {
      const { error } = await db.from("schemas").delete().eq("api_id", api_id);
      if (error) throw error;
    }
    console.log(`  reset: removed ${apiIds.join(", ")}`);
  }

  const schemaIds = new Map<string, string>();

  // Pass 1 — schemas and their non-reference fields.
  for (const seed of SEED) {
    const { data: existing } = await db
      .from("schemas")
      .select("id")
      .eq("api_id", seed.api_id)
      .maybeSingle();

    if (existing) {
      schemaIds.set(seed.api_id, existing.id);
      console.log(`  skip:   schema ${seed.api_id} already exists`);
      continue;
    }

    const { data: created, error } = await db
      .from("schemas")
      .insert({
        name: seed.name,
        api_id: seed.api_id,
        description: seed.description,
      })
      .select("id")
      .single();

    if (error) throw error;
    schemaIds.set(seed.api_id, created.id);
    console.log(`  create: schema ${seed.api_id}`);
  }

  // Pass 2 — fields. References resolve now that every schema id is known.
  for (const seed of SEED) {
    const schemaId = schemaIds.get(seed.api_id)!;

    const { count } = await db
      .from("fields")
      .select("id", { count: "exact", head: true })
      .eq("schema_id", schemaId);

    if (count && count > 0) {
      console.log(`  skip:   fields for ${seed.api_id} already exist`);
      continue;
    }

    const rows = seed.fields.map((f, position) => ({
      schema_id: schemaId,
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required ?? false,
      position,
      target_schema_id: f.target ? schemaIds.get(f.target)! : null,
    }));

    const { error } = await db.from("fields").insert(rows);
    if (error) throw error;
    console.log(`  create: ${rows.length} fields for ${seed.api_id}`);
  }

  // Pass 3 — entries, in SEED order so a referenced schema is populated
  // before the schema that points at it.
  for (const seed of SEED) {
    const schemaId = schemaIds.get(seed.api_id)!;

    const { count } = await db
      .from("entries")
      .select("id", { count: "exact", head: true })
      .eq("schema_id", schemaId);

    if (count && count > 0) {
      console.log(`  skip:   entries for ${seed.api_id} already exist`);
      continue;
    }

    // Resolve reference targets against rows that already exist.
    const referenceFields = seed.fields.filter((f) => f.type === "reference");
    const targetEntries = new Map<string, string[]>();

    for (const field of referenceFields) {
      const targetSchemaId = schemaIds.get(field.target!)!;
      const { data: rows } = await db
        .from("entries")
        .select("id")
        .eq("schema_id", targetSchemaId)
        .order("created_at", { ascending: true });
      targetEntries.set(field.key, (rows ?? []).map((r) => r.id));
    }

    const rows = seed.entries.map((data, i) => {
      const withRefs: Record<string, unknown> = { ...data };
      for (const field of referenceFields) {
        const candidates = targetEntries.get(field.key) ?? [];
        // Round-robin so every seeded entry gets a plausible reference.
        if (candidates.length > 0) {
          withRefs[field.key] = candidates[i % candidates.length];
        }
      }
      return { schema_id: schemaId, data: withRefs as Entry["data"] };
    });

    const { error } = await db.from("entries").insert(rows);
    if (error) throw error;
    console.log(`  create: ${rows.length} entries for ${seed.api_id}`);
  }

  console.log("\n  Seed complete.\n");
}

main().catch((err) => {
  console.error("\n  Seed failed:", err.message ?? err);
  console.error(
    "\n  Did you run supabase/migrations/0001_init.sql against your project?\n",
  );
  process.exit(1);
});
