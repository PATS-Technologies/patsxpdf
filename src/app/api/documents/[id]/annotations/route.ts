import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

const annotationSchema = z.object({
  page: z.number().int().positive(),
  kind: z.enum(["highlight", "note", "circle", "rectangle", "freehand"]),
  color: z.string().max(20),
  geometry: z.record(z.string(), z.unknown()),
  content: z.string().max(4000).nullable().optional(),
});

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser("pdfs-1");
    const { id } = await params;
    const result = await query("SELECT id,page,kind,color,geometry,content FROM annotation WHERE document_id=$1 ORDER BY created_at", [id]);
    return NextResponse.json(result.rows);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("pdfs-2");
    const { id } = await params;
    const data = annotationSchema.parse(await request.json());
    const result = await query(`
      INSERT INTO annotation(document_id,user_id,page,kind,color,geometry,content)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,page,kind,color,geometry,content
    `, [id, user.id, data.page, data.kind, data.color, data.geometry, data.content ?? null]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) { return apiError(error); }
}
