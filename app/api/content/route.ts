import { findAllSchemas } from "@/lib/api/data";
import { apiJson, apiPreflight } from "@/lib/api/errors";
import { handleApiError } from "@/lib/api/handle-error";
import { serializeSchema } from "@/lib/api/serialize";

export const dynamic = "force-dynamic";

/**
 * GET /api/content — discovery.
 *
 * Lists the available content types and their field definitions, so a
 * consuming app can find out what exists without being told out of band.
 * This is the endpoint that makes the read API self-describing, and the one
 * to open first when demonstrating that the panel manages real content.
 */
export async function GET() {
  try {
    const { schemas, fieldsBySchema } = await findAllSchemas();
    const apiIdById = new Map(schemas.map((s) => [s.id, s.api_id]));

    return apiJson({
      data: schemas.map((schema) =>
        serializeSchema(schema, fieldsBySchema.get(schema.id) ?? [], apiIdById),
      ),
      meta: { count: schemas.length },
    });
  } catch (error) {
    return handleApiError(error, "GET /api/content");
  }
}

export async function OPTIONS() {
  return apiPreflight();
}
