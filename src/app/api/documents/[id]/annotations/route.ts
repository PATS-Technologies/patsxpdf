import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

const annotationSchema = z.object({
  page: z.number().int().positive(),
  kind: z.enum(["highlight", "note", "circle", "rectangle", "freehand"]),
  color: z.string().max(20),
  geometry: z.record(z.string(), z.unknown()),
  content: z.string().max(4000).nullable().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser("pdfs-1");
    const { id } = await params;
    const result = await query("SELECT id,page,kind,color,geometry,content FROM annotation WHERE document_id=$1 ORDER BY created_at", [id]);
    return NextResponse.json(result.rows);
  } catch (error) { return apiError(error, request); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("pdfs-2");
    const { id } = await params;
    const data = annotationSchema.parse(await request.json());
    const annotation = await transaction(async (client) => {
      const document = await client.query<{ original_name: string }>("SELECT original_name FROM pdf_document WHERE id=$1", [id]);
      const result = await client.query(`
        INSERT INTO annotation(document_id,user_id,page,kind,color,geometry,content)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,page,kind,color,geometry,content
      `, [id, user.id, data.page, data.kind, data.color, data.geometry, data.content ?? null]);
      const created = result.rows[0];
      await writeAudit({ actorId: user.id, action: "annotation.create", resourceType: "annotation", resourceId: created.id as string, filename: document.rows[0]?.original_name, details: { documentId: id, page: data.page, kind: data.kind }, request }, client);
      return created;
    });
    return NextResponse.json(annotation, { status: 201 });
  } catch (error) { return apiError(error, request); }
}
