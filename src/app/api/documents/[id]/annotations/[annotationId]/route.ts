import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

const geometrySchema = z.object({
  geometry: z.record(z.string(), z.unknown()),
});

type RouteContext = { params: Promise<{ id: string; annotationId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireUser("pdfs-2");
    const { id, annotationId } = await params;
    const { geometry } = geometrySchema.parse(await request.json());
    const result = await query(`
      UPDATE annotation SET geometry=$1, updated_at=now()
      WHERE id=$2 AND document_id=$3
      RETURNING id,page,kind,color,geometry,content
    `, [geometry, annotationId, id]);
    if (!result.rows[0]) return NextResponse.json({ error: "Anotação não encontrada." }, { status: 404 });
    return NextResponse.json(result.rows[0]);
  } catch (error) { return apiError(error); }
}

export async function DELETE(_: Request, { params }: RouteContext) {
  try {
    await requireUser("pdfs-2");
    const { id, annotationId } = await params;
    const result = await query("DELETE FROM annotation WHERE id=$1 AND document_id=$2 RETURNING id", [annotationId, id]);
    if (!result.rows[0]) return NextResponse.json({ error: "Anotação não encontrada." }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) { return apiError(error); }
}
