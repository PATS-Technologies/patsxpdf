import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query, transaction } from "@/lib/db";
import { apiError } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { serverTranslate } from "@/lib/i18n-server";

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
      return NextResponse.json({ error: await serverTranslate("error.validPdf") }, { status: 400 });
    }
    const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;
    if (file.size > maxBytes) return NextResponse.json({ error: await serverTranslate("error.pdfTooLarge") }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const id = randomUUID();
    const storageName = `${id}.pdf`;
    await mkdir(storagePath, { recursive: true });
    await writeFile(path.join(storagePath, storageName), bytes);
    const documentDate = pdf.getCreationDate();
    const document = await transaction(async (client) => {
      const result = await client.query(`
        INSERT INTO pdf_document(id,original_name,storage_name,size_bytes,page_count,document_date,uploaded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7)
        RETURNING id,original_name,page_count,size_bytes,uploaded_at,document_date
      `, [id, file.name, storageName, file.size, pdf.getPageCount(), documentDate ?? null, user.id]);
      await writeAudit({ actorId: user.id, action: "document.upload", resourceType: "pdf_document", resourceId: id, details: { fileName: file.name, sizeBytes: file.size, pageCount: pdf.getPageCount() }, request }, client);
      return result.rows[0];
    });
    return NextResponse.json(document, { status: 201 });
  } catch (error) { return apiError(error); }
}
