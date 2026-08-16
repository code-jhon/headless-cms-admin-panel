import type { NextRequest } from "next/server";

import { findEntries, findSchema } from "@/lib/api/data";
import { apiError, apiJson, apiPreflight } from "@/lib/api/errors";
import { expandReferences } from "@/lib/api/expand";
import { handleApiError } from "@/lib/api/handle-error";
import { parseListParams } from "@/lib/api/params";
import { buildListMeta, serializeEntry } from "@/lib/api/serialize";

export const dynamic = "force-dynamic";

/**
 * GET /api/content/[type] — a collection (PRD E1, E3, E4).
 *
 * Query parameters:
 *   limit      1–100, default 20
 *   offset     default 0
 *   order      any field key; default is most recently updated
 *   direction  asc | desc
 *   expand     comma-separated reference keys, or `*`
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ apiId: string }> },
) {
  const { apiId } = await params;

  try {
    const found = await findSchema(apiId);
    if (!found) {
      return apiError(
        "unknown_type",
        `No content type with the API ID "${apiId}".`,
      );
    }

    const { schema, fields } = found;
    const searchParams = request.nextUrl.searchParams;

    const parsed = parseListParams(searchParams, fields);
    if (!parsed.ok) {
      return apiError(
        "invalid_parameter",
        "One or more query parameters are invalid.",
        parsed.details,
      );
    }

    const { limit, offset, expand, orderBy, direction } = parsed.params;

    const { entries, total } = await findEntries(schema.id, {
      limit,
      offset,
      orderBy,
      direction,
    });

    const expanded = await expandReferences(entries, fields, expand);

    return apiJson({
      data: entries.map((entry) =>
        serializeEntry(entry, fields, expanded, expand),
      ),
      meta: buildListMeta({
        type: schema.api_id,
        count: entries.length,
        total,
        limit,
        offset,
        query: searchParams,
      }),
    });
  } catch (error) {
    return handleApiError(error, `GET /api/content/${apiId}`);
  }
}

export async function OPTIONS() {
  return apiPreflight();
}
