import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { apiError, errorResponse } from "@/lib/http";
import { failOcrTask, syncOcrTask } from "@/lib/ocr-tasks";
import { ocrPage, parseOcrLanguages, PdfboxServiceError } from "@/lib/pdfbox-service";
import { serverTranslate } from "@/lib/i18n-server";

const requestSchema = z.object({
  documentId: z.string().uuid(),
  page: z.number().int().positive(),
  languages: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  let taskId: string | null = null;
  try {
    const user = await requireUser("pdfs-2");
    const input = requestSchema.parse(await request.json());
    const languages = parseOcrLanguages(input.languages);
    const result = await query<{ storage_name: string; original_name: string; size_bytes: string; page_count: number }>(`
      SELECT storage_name,original_name,size_bytes,page_count FROM pdf_document WHERE id=$1
    `, [input.documentId]);
    const document = result.rows[0];
    if (!document) return errorResponse(request, await serverTranslate("error.pdfNotFound"), 404, { actorId: user.id });
    if (input.page > document.page_count) {
      return errorResponse(request, await serverTranslate("error.invalidData"), 400, {
        actorId: user.id,
        details: { page: input.page, pageCount: document.page_count },
      });
    }

    taskId = randomUUID();
    await query(`
      INSERT INTO ocr_task(id,user_id,document_id,mode,page_number,original_name,source_size_bytes,languages,status)
      VALUES($1,$2,$3,'page',$4,$5,$6,$7,'processing')
    `, [taskId, user.id, input.documentId, input.page, document.original_name, document.size_bytes, languages]);

    const storagePath = process.env.PDF_STORAGE ?? path.join(process.cwd(), "data", "pdfs");
    const bytes = await readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ storagePath, document.storage_name));
    const file = new File([bytes], document.original_name, { type: "application/pdf" });
    const resultOcr = await ocrPage(taskId, file, input.page, languages);
    const task = await syncOcrTask(resultOcr.job);
    await writeAudit({
      actorId: user.id,
      action: "ocr.page",
      resourceType: "pdf_document",
      resourceId: input.documentId,
      filename: document.original_name,
      details: { taskId, page: input.page, languages },
      request,
    });
    return Response.json({
      task,
      text: resultOcr.text,
      pdfUrl: `/api/ocr/jobs/${taskId}/pdf`,
      textUrl: `/api/ocr/jobs/${taskId}/text`,
    });
  } catch (error) {
    if (taskId) await failOcrTask(taskId, error);
    if (error instanceof PdfboxServiceError) {
      return errorResponse(request, await serverTranslate("error.ocrFailed"), error.status, { cause: error });
    }
    return apiError(error, request);
  }
}
