/**
 * Domain types for the headless CMS.
 *
 * These mirror the tables in supabase/migrations/0001_init.sql. Once the
 * project is linked you can replace the Database type with the generated
 * one (`supabase gen types typescript`), but hand-writing it keeps
 * milestone 0 runnable without the CLI.
 */

export const FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "reference",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type ContentSchema = {
  id: string;
  name: string;
  api_id: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type Field = {
  id: string;
  schema_id: string;
  /** Machine name — also the JSONB key inside `Entry.data`. */
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  position: number;
  /** Set only when `type === "reference"`. */
  target_schema_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A schema plus its ordered fields — the unit the UI works with. */
export type SchemaWithFields = ContentSchema & {
  fields: Field[];
}

/** Values a field can hold once stored. References hold the target entry id. */
export type FieldValue = string | number | boolean | null;

export type Entry = {
  id: string;
  schema_id: string;
  data: Record<string, FieldValue>;
  /** Set by a schema migration when the row no longer fits (PRD D4). */
  invalid: boolean;
  created_at: string;
  /** Doubles as the optimistic-concurrency token (PRD C3). */
  updated_at: string;
}

/**
 * Minimal Database shape for the typed Supabase client.
 *
 * Matches the structure `supabase gen types typescript` produces — including
 * the `Relationships` key, which postgrest-js requires for the generics to
 * resolve. Swap in the generated file once the project is linked.
 */
export interface Database {
  public: {
    Tables: {
      schemas: {
        Row: ContentSchema;
        Insert: Partial<ContentSchema> & Pick<ContentSchema, "name" | "api_id">;
        Update: Partial<ContentSchema>;
        Relationships: [];
      };
      fields: {
        Row: Field;
        Insert: Partial<Field> &
          Pick<Field, "schema_id" | "key" | "label" | "type">;
        Update: Partial<Field>;
        Relationships: [
          {
            foreignKeyName: "fields_schema_id_fkey";
            columns: ["schema_id"];
            isOneToOne: false;
            referencedRelation: "schemas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fields_target_schema_id_fkey";
            columns: ["target_schema_id"];
            isOneToOne: false;
            referencedRelation: "schemas";
            referencedColumns: ["id"];
          },
        ];
      };
      entries: {
        Row: Entry;
        Insert: Partial<Entry> & Pick<Entry, "schema_id">;
        Update: Partial<Entry>;
        Relationships: [
          {
            foreignKeyName: "entries_schema_id_fkey";
            columns: ["schema_id"];
            isOneToOne: false;
            referencedRelation: "schemas";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: { field_type: FieldType };
    CompositeTypes: Record<string, never>;
  };
}
