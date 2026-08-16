import type { NextRequest } from "next/server";

import { findEntry, findSchema } from "@/lib/api/data";
import { apiError, apiJson, apiPreflight } from "@/lib/api/errors";
import { expandReferences } from "@/lib/api/expand";
import { handleApiError } from "@/lib/api/handle-error";
import { parseListParams } from "@/lib/api/params";
import { serializeEntry } from "@/lib/api/serialize";

export const dynamic = "force-dynamic";

/**
 * GET /api/content/[type]/[id] — a single entry (PRD E2, E3, E4).
 *
 * Supports `expand` on the same terms as the collection endpoint. An entry
 * that exists but belongs to another content type is reported as not found:
 * from the caller's point of view it is not at this URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ apiId: string; entryId: string }> },
) {
  const { apiId, entryId } = await params;

  try {
    const found = await findSchema(apiId);
    if (!found) {
      return apiError(
        "unknown_type",
        `No content type with the API ID "${apiId}".`,
      );
    }

    const { schema, fields } = found;

    const parsed = parseListParams(request.nextUrl.searchParams, fields);
    if (!parsed.ok) {
      return apiError(
        "invalid_parameter",
        "One or more query parameters are invalid.",
        parsed.details,
      );
    }

    const entry = await findEntry(schema.id, entryId);
    if (!entry) {
      return apiError(
        "not_found",
        `No ${schema.api_id} entry with the id "${entryId}".`,
      );
    }

    const { expand } = parsed.params;
    const expanded = await expandReferences([entry], fields, expand);

    return apiJson({
      data: serializeEntry(entry, fields, expanded, expand),
      meta: { type: schema.api_id },
    });
  } catch (error) {
    return handleApiError(error, `GET /api/content/${apiId}/${entryId}`);
  }
}

export async function OPTIONS() {
  return apiPreflight();
}
