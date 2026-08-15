import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { ContentSchema, Entry, Field } from "@/types/cms";

/**
 * Route-handler tests.
 *
 * These import and invoke the *real* handlers, with only the database layer
 * (`lib/api/data`) stubbed. Status codes, error codes, response shape,
 * pagination arithmetic and expansion are therefore covered end to end
 * without needing a live Supabase project.
 */

const { mocks } = vi.hoisted(() => ({
  mocks: {
    findSchema: vi.fn(),
    findEntries: vi.fn(),
    findEntry: vi.fn(),
    findExpansionTargets: vi.fn(),
    findAllSchemas: vi.fn(),
  },
}));

class ApiUnavailableError extends Error {}

vi.mock("@/lib/api/data", () => ({
  ApiUnavailableError,
  findSchema: mocks.findSchema,
  findEntries: mocks.findEntries,
  findEntry: mocks.findEntry,
  findExpansionTargets: mocks.findExpansionTargets,
  findAllSchemas: mocks.findAllSchemas,
}));

const { GET: getCollection } = await import("@/app/api/content/[apiId]/route");
const { GET: getEntry } = await import(
  "@/app/api/content/[apiId]/[entryId]/route"
);
const { GET: getTypes } = await import("@/app/api/content/route");

/* ------------------------------------------------------------- fixtures */

const ARTICLE_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const ADA_ID = "33333333-3333-4333-8333-333333333333";

const ARTICLE: ContentSchema = {
  id: ARTICLE_ID,
  name: "Article",
  api_id: "article",
  description: "A piece of written content.",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function field(overrides: Partial<Field> & { key: string }): Field {
  return {
    id: `f-${overrides.key}`,
    schema_id: ARTICLE_ID,
    label: overrides.key,
    type: "text",
    required: false,
    position: 0,
    target_schema_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ARTICLE_FIELDS: Field[] = [
  field({ key: "title", label: "Title", required: true, position: 0 }),
  field({ key: "read_time", label: "Read time", type: "number", position: 1 }),
  field({
    key: "author",
    label: "Author",
    type: "reference",
    target_schema_id: PERSON_ID,
    position: 2,
  }),
];

const PERSON_FIELDS: Field[] = [
  { ...field({ key: "full_name", label: "Full name" }), schema_id: PERSON_ID },
];

function entry(id: string, data: Record<string, unknown>, invalid = false): Entry {
  return {
    id,
    schema_id: ARTICLE_ID,
    data: data as Entry["data"],
    invalid,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
  };
}

const ENTRIES = [
  entry("aaaaaaaa-1111-4111-8111-111111111111", {
    title: "Notes on the Analytical Engine",
    read_time: 7,
    author: ADA_ID,
  }),
  entry("aaaaaaaa-2222-4222-8222-222222222222", {
    title: "On Compilers",
    read_time: 4,
    author: null,
  }),
];

function get(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findSchema.mockImplementation(async (apiId: string) =>
    apiId === "article" ? { schema: ARTICLE, fields: ARTICLE_FIELDS } : null,
  );
  mocks.findEntries.mockResolvedValue({ entries: ENTRIES, total: 2 });
  mocks.findEntry.mockResolvedValue(ENTRIES[0]);
  mocks.findExpansionTargets.mockResolvedValue({
    entries: [
      {
        id: ADA_ID,
        schema_id: PERSON_ID,
        data: { full_name: "Ada Lovelace" },
        invalid: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    fieldsBySchema: new Map([[PERSON_ID, PERSON_FIELDS]]),
  });
});

/* ------------------------------------------------------------ collection */

describe("GET /api/content/[type]", () => {
  it("returns the collection with meta", async () => {
    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({
      type: "article",
      count: 2,
      total: 2,
      limit: 20,
      offset: 0,
      next: null,
    });
  });

  it("returns a flat entry shape with envelope fields alongside content", async () => {
    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();

    expect(Object.keys(body.data[0]).sort()).toEqual([
      "author",
      "created_at",
      "id",
      "invalid",
      "read_time",
      "title",
      "updated_at",
    ]);
  });

  it("shapes entries by the schema, not the stored row", async () => {
    // This row predates `read_time` and still holds a key from a deleted field.
    mocks.findEntries.mockResolvedValue({
      entries: [entry("bbbbbbbb-1111-4111-8111-111111111111", {
        title: "Old",
        removed_field: "should not appear",
      })],
      total: 1,
    });

    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();

    expect(body.data[0].read_time).toBeNull();
    expect(body.data[0].removed_field).toBeUndefined();
  });

  it("404s an unknown content type with a typed error", async () => {
    const res = await getCollection(get("/api/content/nope"), {
      params: Promise.resolve({ apiId: "nope" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("unknown_type");
    expect(body.error.message).toContain("nope");
  });

  it("sets permissive CORS and no-store on success", async () => {
    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reports the store being unconfigured as 503, not 500", async () => {
    mocks.findSchema.mockRejectedValue(new ApiUnavailableError("not set up"));

    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe("not_configured");
  });

  it("reports an unexpected failure as 500", async () => {
    mocks.findEntries.mockRejectedValue(new Error("something odd"));

    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("internal_error");
  });

  it("reports an unreachable database as 503, not 500", async () => {
    // A paused free-tier project surfaces exactly this. 500 would tell a
    // consumer "your request is broken"; 503 tells it "retry shortly".
    mocks.findEntries.mockRejectedValue(new TypeError("fetch failed"));

    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe("store_unavailable");
  });

  it("never echoes an internal error message to the caller", async () => {
    mocks.findEntries.mockRejectedValue(
      new Error("password=hunter2 at /srv/app/lib/secret.ts:42"),
    );

    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();

    expect(body.error.message).not.toContain("hunter2");
    expect(body.error.message).not.toContain("/srv/app");
    expect(body.error.message).toBe("Something went wrong handling this request.");
  });
});

/* ------------------------------------------------------------ pagination */

describe("pagination", () => {
  it("passes limit and offset through to the query", async () => {
    await getCollection(get("/api/content/article?limit=5&offset=10"), {
      params: Promise.resolve({ apiId: "article" }),
    });

    expect(mocks.findEntries).toHaveBeenCalledWith(
      ARTICLE_ID,
      expect.objectContaining({ limit: 5, offset: 10 }),
    );
  });

  it("builds a next link while more rows remain", async () => {
    mocks.findEntries.mockResolvedValue({ entries: ENTRIES, total: 50 });

    const res = await getCollection(get("/api/content/article?limit=2"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const { meta } = await res.json();

    expect(meta.next).toBe("/api/content/article?limit=2&offset=2");
  });

  it("omits the next link on the last page", async () => {
    mocks.findEntries.mockResolvedValue({ entries: ENTRIES, total: 2 });

    const res = await getCollection(get("/api/content/article?limit=2&offset=0"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    expect((await res.json()).meta.next).toBeNull();
  });

  it("preserves other parameters in the next link", async () => {
    mocks.findEntries.mockResolvedValue({ entries: ENTRIES, total: 50 });

    const res = await getCollection(
      get("/api/content/article?limit=2&expand=author"),
      { params: Promise.resolve({ apiId: "article" }) },
    );
    const { meta } = await res.json();

    expect(meta.next).toContain("expand=author");
    expect(meta.next).toContain("offset=2");
  });
});

/* ------------------------------------------------------- bad parameters */

describe("parameter validation", () => {
  const cases: Array<[string, string]> = [
    ["limit=abc", "limit"],
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["offset=-1", "offset"],
    ["offset=1.5", "offset"],
    ["order=nonexistent", "order"],
    ["direction=sideways", "direction"],
    ["expand=nonexistent", "expand"],
  ];

  it.each(cases)("rejects ?%s with a 400 naming %s", async (query, key) => {
    const res = await getCollection(get(`/api/content/article?${query}`), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("invalid_parameter");
    expect(body.error.details).toHaveProperty(key);
  });

  it("accepts the maximum limit", async () => {
    const res = await getCollection(get("/api/content/article?limit=100"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    expect(res.status).toBe(200);
  });

  it("names the available fields when order is wrong", async () => {
    const res = await getCollection(get("/api/content/article?order=nope"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();
    expect(body.error.details.order).toContain("title");
  });
});

/* ---------------------------------------------------------------- expand */

describe("reference expansion", () => {
  it("returns references as ids by default", async () => {
    const res = await getCollection(get("/api/content/article"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    const body = await res.json();

    expect(body.data[0].author).toBe(ADA_ID);
    expect(mocks.findExpansionTargets).not.toHaveBeenCalled();
  });

  it("expands a named reference into an object", async () => {
    const res = await getCollection(
      get("/api/content/article?expand=author"),
      { params: Promise.resolve({ apiId: "article" }) },
    );
    const body = await res.json();

    expect(body.data[0].author).toMatchObject({
      id: ADA_ID,
      full_name: "Ada Lovelace",
    });
  });

  it("expands everything with expand=*", async () => {
    const res = await getCollection(get("/api/content/article?expand=*"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    expect((await res.json()).data[0].author).toMatchObject({
      full_name: "Ada Lovelace",
    });
  });

  it("leaves a null reference as null when expanding", async () => {
    const res = await getCollection(
      get("/api/content/article?expand=author"),
      { params: Promise.resolve({ apiId: "article" }) },
    );
    expect((await res.json()).data[1].author).toBeNull();
  });

  it("expands a dangling reference to null rather than dropping the key", async () => {
    mocks.findExpansionTargets.mockResolvedValue({
      entries: [],
      fieldsBySchema: new Map(),
    });

    const res = await getCollection(
      get("/api/content/article?expand=author"),
      { params: Promise.resolve({ apiId: "article" }) },
    );
    const body = await res.json();

    expect(body.data[0]).toHaveProperty("author");
    expect(body.data[0].author).toBeNull();
  });

  it("resolves the whole page in one round trip", async () => {
    await getCollection(get("/api/content/article?expand=author"), {
      params: Promise.resolve({ apiId: "article" }),
    });
    // The N+1 guard: one call regardless of how many entries reference.
    expect(mocks.findExpansionTargets).toHaveBeenCalledTimes(1);
  });

  it("does not expand a second level", async () => {
    const res = await getCollection(
      get("/api/content/article?expand=author"),
      { params: Promise.resolve({ apiId: "article" }) },
    );
    const author = (await res.json()).data[0].author;
    // Person has no reference fields here, but the guarantee is structural:
    // the nested object is serialized with no expand keys.
    expect(Object.keys(author)).toEqual([
      "id",
      "created_at",
      "updated_at",
      "invalid",
      "full_name",
    ]);
  });
});

/* ---------------------------------------------------------- single entry */

describe("GET /api/content/[type]/[id]", () => {
  it("returns one entry", async () => {
    const res = await getEntry(
      get(`/api/content/article/${ENTRIES[0].id}`),
      {
        params: Promise.resolve({
          apiId: "article",
          entryId: ENTRIES[0].id,
        }),
      },
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(ENTRIES[0].id);
    expect(body.data.title).toBe("Notes on the Analytical Engine");
    expect(body.meta.type).toBe("article");
  });

  it("404s a missing entry", async () => {
    mocks.findEntry.mockResolvedValue(null);

    const res = await getEntry(get("/api/content/article/does-not-exist"), {
      params: Promise.resolve({ apiId: "article", entryId: "does-not-exist" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("404s an unknown content type before looking up the entry", async () => {
    const res = await getEntry(get("/api/content/nope/x"), {
      params: Promise.resolve({ apiId: "nope", entryId: "x" }),
    });

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("unknown_type");
    expect(mocks.findEntry).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the schema, so a foreign id is not found", async () => {
    await getEntry(get("/api/content/article/x"), {
      params: Promise.resolve({ apiId: "article", entryId: "x" }),
    });
    expect(mocks.findEntry).toHaveBeenCalledWith(ARTICLE_ID, "x");
  });

  it("supports expand", async () => {
    const res = await getEntry(
      get(`/api/content/article/${ENTRIES[0].id}?expand=author`),
      {
        params: Promise.resolve({
          apiId: "article",
          entryId: ENTRIES[0].id,
        }),
      },
    );
    expect((await res.json()).data.author).toMatchObject({
      full_name: "Ada Lovelace",
    });
  });

  it("rejects a bad parameter with 400", async () => {
    const res = await getEntry(
      get("/api/content/article/x?expand=nonexistent"),
      { params: Promise.resolve({ apiId: "article", entryId: "x" }) },
    );
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------- discovery */

describe("GET /api/content", () => {
  it("describes every content type and its fields", async () => {
    mocks.findAllSchemas.mockResolvedValue({
      schemas: [
        ARTICLE,
        {
          ...ARTICLE,
          id: PERSON_ID,
          name: "Person",
          api_id: "person",
          description: null,
        },
      ],
      fieldsBySchema: new Map([
        [ARTICLE_ID, ARTICLE_FIELDS],
        [PERSON_ID, PERSON_FIELDS],
      ]),
    });

    const res = await getTypes();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.count).toBe(2);
    expect(body.data[0]).toMatchObject({
      api_id: "article",
      url: "/api/content/article",
    });
  });

  it("describes a reference by the target's public api_id, not its uuid", async () => {
    mocks.findAllSchemas.mockResolvedValue({
      schemas: [
        ARTICLE,
        { ...ARTICLE, id: PERSON_ID, name: "Person", api_id: "person" },
      ],
      fieldsBySchema: new Map([[ARTICLE_ID, ARTICLE_FIELDS]]),
    });

    const res = await getTypes();
    const body = await res.json();
    const author = body.data[0].fields.find(
      (f: { key: string }) => f.key === "author",
    );

    expect(author.references).toBe("person");
    expect(author.type).toBe("reference");
  });

  it("returns an empty list rather than an error when nothing is defined", async () => {
    mocks.findAllSchemas.mockResolvedValue({
      schemas: [],
      fieldsBySchema: new Map(),
    });

    const res = await getTypes();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });
});
