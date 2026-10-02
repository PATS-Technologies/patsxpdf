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
import { convertOfficeToPdf, OfficeConversionError } from "@/lib/office-converter";
import { analyzeOfficeDocument } from "@/lib/office-analysis";

const storagePath = process.env.PDF_STORAGE ?? path.join(process.cwd(), "data", "pdfs");
const supportedOfficeExtensions = new Set([".docx", ".xlsx", ".pptx"]);

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
  let conversionTaskId: string | null = null;
  try {
    const user = await requireUser("pdfs-2");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: await serverTranslate("error.validPdf") }, { status: 400 });
    }
    const extension = path.extname(file.name).toLowerCase();
    const isPdf = extension === ".pdf" || file.type === "application/pdf";
    const isOfficeDocument = supportedOfficeExtensions.has(extension);
    if (!isPdf && !isOfficeDocument) return NextResponse.json({ error: await serverTranslate("error.validPdf") }, { status: 400 });

    if (isOfficeDocument) {
      const requestedConversionId = form.get("conversionId");
      conversionTaskId = typeof requestedConversionId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedConversionId)
        ? requestedConversionId
        : randomUUID();
      await query(`
        INSERT INTO conversion_task(id,user_id,original_name,source_mime_type,source_size_bytes,status)
        VALUES($1,$2,$3,$4,$5,'processing')
      `, [conversionTaskId, user.id, file.name, file.type || null, file.size]);
    }

    const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;
    if (file.size > maxBytes) {
      const message = await serverTranslate("error.pdfTooLarge");
      if (conversionTaskId) {
        await query("UPDATE conversion_task SET status='error',details=$2,completed_at=now() WHERE id=$1", [conversionTaskId, message]);
        return NextResponse.json({ error: message, conversionId: conversionTaskId, officeDocument: true }, { status: 413 });
      }
      return NextResponse.json({ error: message }, { status: 413 });
    }

    let bytes: Uint8Array;
    const diagnostics: string[] = [];
    try {
      if (isOfficeDocument) {
        const sourceBytes = new Uint8Array(await file.arrayBuffer());
        const analysis = await analyzeOfficeDocument(sourceBytes);
        if (analysis.missingFonts.length) {
          diagnostics.push(await serverTranslate("conversion.missingFonts", { fonts: analysis.missingFonts.join(", ") }));
        }
        if (analysis.externalReferences.length) {
          diagnostics.push(await serverTranslate("conversion.externalReferences", {
            count: analysis.externalReferences.length,
            references: analysis.externalReferences.join(", "),
          }));
        }
        bytes = await convertOfficeToPdf(file);
      } else {
        bytes = new Uint8Array(await file.arrayBuffer());
      }
    } catch (error) {
      if (conversionTaskId) {
        const key = error instanceof OfficeConversionError && error.reason === "unavailable"
          ? "error.converterUnavailable"
          : "error.conversionFailed";
        const message = await serverTranslate(key);
        const details = error instanceof OfficeConversionError ? `${message}\n${error.details}` : `${message}\n${error instanceof Error ? error.message : String(error)}`;
        await query("UPDATE conversion_task SET status='error',details=$2,completed_at=now() WHERE id=$1", [conversionTaskId, details]);
        return NextResponse.json({ error: message, conversionId: conversionTaskId, officeDocument: true }, { status: 502 });
      }
      throw error;
    }

    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    } catch (error) {
      if (isOfficeDocument) {
        console.error("LibreOffice returned an invalid PDF", error);
        const message = await serverTranslate("error.conversionFailed");
        await query("UPDATE conversion_task SET status='error',details=$2,completed_at=now() WHERE id=$1", [conversionTaskId, message]);
        return NextResponse.json({ error: message, conversionId: conversionTaskId, officeDocument: true }, { status: 502 });
      }
      return NextResponse.json({ error: await serverTranslate("error.validPdf") }, { status: 400 });
    }
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
      `, [id, file.name, storageName, bytes.byteLength, pdf.getPageCount(), documentDate ?? null, user.id]);
      if (conversionTaskId) {
        await client.query(`
          UPDATE conversion_task
          SET document_id=$2,status=$3,details=$4,completed_at=now()
          WHERE id=$1
        `, [conversionTaskId, id, diagnostics.length ? "alert" : "ok", diagnostics.length ? diagnostics.join("\n") : null]);
      }
      await writeAudit({ actorId: user.id, action: "document.upload", resourceType: "pdf_document", resourceId: id, details: { fileName: file.name, sourceSizeBytes: file.size, sizeBytes: bytes.byteLength, pageCount: pdf.getPageCount(), converted: isOfficeDocument }, request }, client);
      return result.rows[0];
    });
    return NextResponse.json(conversionTaskId
      ? { document, conversionId: conversionTaskId, conversionStatus: diagnostics.length ? "alert" : "ok", officeDocument: true }
      : document, { status: 201 });
  } catch (error) {
    if (conversionTaskId) {
      const details = error instanceof Error ? error.message : String(error);
      await query("UPDATE conversion_task SET status='error',details=$2,completed_at=now() WHERE id=$1 AND status='processing'", [conversionTaskId, details]);
    }
    return apiError(error);
  }
}
