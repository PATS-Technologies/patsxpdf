import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { apiError, errorResponse } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { serverTranslate } from "@/lib/i18n-server";

const geometrySchema = z.object({
  geometry: z.record(z.string(), z.unknown()),
});

type RouteContext = { params: Promise<{ id: string; annotationId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser("pdfs-2");
    const { id, annotationId } = await params;
    const { geometry } = geometrySchema.parse(await request.json());
    const document = await query<{ original_name: string }>("SELECT original_name FROM pdf_document WHERE id=$1", [id]);
    const annotation = await transaction(async (client) => {
      const result = await client.query(`
        UPDATE annotation SET geometry=$1, updated_at=now()
        WHERE id=$2 AND document_id=$3
        RETURNING id,page,kind,color,geometry,content
      `, [geometry, annotationId, id]);
      if (!result.rows[0]) return null;
      await writeAudit({ actorId: user.id, action: "annotation.update", resourceType: "annotation", resourceId: annotationId, filename: document.rows[0]?.original_name, details: { documentId: id, fields: ["geometry"] }, request }, client);
      return result.rows[0];
    });
    if (!annotation) return errorResponse(request, await serverTranslate("error.annotationNotFound"), 404, { actorId: user.id, filename: document.rows[0]?.original_name, details: { documentId: id, annotationId } });
    return NextResponse.json(annotation);
  } catch (error) { return apiError(error, request); }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser("pdfs-2");
    const { id, annotationId } = await params;
    const document = await query<{ original_name: string }>("SELECT original_name FROM pdf_document WHERE id=$1", [id]);
    const deleted = await transaction(async (client) => {
      const result = await client.query("DELETE FROM annotation WHERE id=$1 AND document_id=$2 RETURNING id", [annotationId, id]);
      if (!result.rows[0]) return false;
      await writeAudit({ actorId: user.id, action: "annotation.delete", resourceType: "annotation", resourceId: annotationId, filename: document.rows[0]?.original_name, details: { documentId: id }, request }, client);
      return true;
    });
    if (!deleted) return errorResponse(request, await serverTranslate("error.annotationNotFound"), 404, { actorId: user.id, filename: document.rows[0]?.original_name, details: { documentId: id, annotationId } });
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error, request); }
}
