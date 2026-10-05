import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { formatExtractionId, listExtractionTasks } from "@/lib/extraction-tasks";
import { apiError, errorResponse } from "@/lib/http";
import { extractSinglePage, parseOcrLanguages, PdfboxServiceError, submitExtractionJob } from "@/lib/pdfbox-service";
import { serverTranslate } from "@/lib/i18n-server";

const schema = z.object({
  documentId: z.string().uuid(),
  pages: z.array(z.number().int().positive()).min(1),
  languages: z.array(z.string()).optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireUser("pdfs-1");
    const tasks = await listExtractionTasks(user);
    return Response.json(tasks.map((task) => ({ ...task, display_id: formatExtractionId(task.public_id) })));
  } catch (error) {
    return apiError(error, request);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("pdfs-2");
    const input = schema.parse(await request.json());
    const pages = [...new Set(input.pages)].sort((left, right) => left - right);
    const languages = parseOcrLanguages(input.languages);
    const result = await query<{ storage_name: string; original_name: string; page_count: number }>(
      "SELECT storage_name,original_name,page_count FROM pdf_document WHERE id=$1",
      [input.documentId],
    );
    const document = result.rows[0];
    if (!document) return errorResponse(request, await serverTranslate("error.pdfNotFound"), 404, { actorId: user.id });
    if (pages.some((page) => page > document.page_count)) {
      return errorResponse(request, await serverTranslate("error.invalidData"), 400, { actorId: user.id });
    }
    const storagePath = process.env.PDF_STORAGE ?? path.join(process.cwd(), "data", "pdfs");
    const bytes = await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ storagePath, document.storage_name));
    const file = new File([bytes], document.original_name, { type: "application/pdf" });
    const id = randomUUID();

    if (pages.length === 1) {
      const extraction = await extractSinglePage(id, file, pages[0], languages);
      return Response.json({
        id,
        text: extraction.text,
        json: JSON.parse(extraction.json),
      });
    }

    const inserted = await query<{ public_id: string }>(`
      INSERT INTO extraction_task(id,user_id,document_id,original_name,requested_pages,languages,status,total_pages)
      VALUES($1,$2,$3,$4,$5,$6,'queued',$7)
      RETURNING public_id
    `, [id, user.id, input.documentId, document.original_name, pages, languages, pages.length]);
    try {
      await submitExtractionJob(id, file, pages, languages);
    } catch (error) {
      await query("UPDATE extraction_task SET status='error',error=$2,completed_at=now() WHERE id=$1", [id, error instanceof Error ? error.message : String(error)]);
      throw error;
    }
    await writeAudit({
      actorId: user.id,
      action: "extraction.submit",
      resourceType: "extraction_task",
      resourceId: id,
      filename: document.original_name,
      details: { pages, languages, publicId: inserted.rows[0].public_id },
      request,
    });
    return Response.json({
      id,
      displayId: formatExtractionId(inserted.rows[0].public_id),
      statusUrl: `/api/extractions/${id}`,
    }, { status: 202 });
  } catch (error) {
    if (error instanceof PdfboxServiceError) {
      return errorResponse(request, await serverTranslate("error.extractionFailed"), error.status, { cause: error });
    }
    return apiError(error, request);
  }
}
