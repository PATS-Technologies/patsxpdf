import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

const storagePath = process.env.PDF_STORAGE ?? path.join(process.cwd(), "data", "pdfs");

export async function GET() {
  try {
    await requireUser("pdfs-1");
    const result = await query(`
      SELECT id, original_name, page_count, size_bytes, uploaded_at, document_date
      FROM pdf_document ORDER BY uploaded_at DESC
    `);
    return NextResponse.json(result.rows);
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("pdfs-2");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
      return NextResponse.json({ error: "Selecione um arquivo PDF válido." }, { status: 400 });
    }
    const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;
    if (file.size > maxBytes) return NextResponse.json({ error: "O PDF excede o limite configurado." }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const id = randomUUID();
    const storageName = `${id}.pdf`;
    await mkdir(storagePath, { recursive: true });
    await writeFile(path.join(storagePath, storageName), bytes);
    const documentDate = pdf.getCreationDate();
    const result = await query(`
      INSERT INTO pdf_document(id,original_name,storage_name,size_bytes,page_count,document_date,uploaded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING id,original_name,page_count,size_bytes,uploaded_at,document_date
    `, [id, file.name, storageName, file.size, pdf.getPageCount(), documentDate ?? null, user.id]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) { return apiError(error); }
}
