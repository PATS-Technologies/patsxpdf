import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { apiError, errorResponse } from "@/lib/http";
import { failOcrTask, type OcrTaskRow, syncOcrTask } from "@/lib/ocr-tasks";
import { parseOcrLanguages, PdfboxServiceError, submitOcrJob } from "@/lib/pdfbox-service";
import { serverTranslate } from "@/lib/i18n-server";

export async function GET(request: Request) {
  try {
    const user = await requireUser("pdfs-1");
    const result = await query<OcrTaskRow>(`
      SELECT o.id,o.user_id,o.document_id,o.mode,o.page_number,o.original_name,o.source_size_bytes,o.languages,
        o.status,o.total_pages,o.processed_pages,o.error,o.created_at,o.completed_at,
        u.login AS user_login,u.name AS user_name
      FROM ocr_task o
      JOIN app_user u ON u.id=o.user_id
      WHERE $2::boolean OR o.user_id=$1
      ORDER BY o.created_at DESC
      LIMIT 500
    `, [user.id, user.isAdmin]);
    return Response.json(result.rows);
  } catch (error) {
    return apiError(error, request);
  }
}

export async function POST(request: Request) {
  let taskId: string | null = null;
  try {
    const user = await requireUser("pdfs-2");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
      return errorResponse(request, await serverTranslate("error.validPdf"), 400, { actorId: user.id });
    }
    const maxBytes = Number(process.env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;
    if (file.size > maxBytes) {
      return errorResponse(request, await serverTranslate("error.pdfTooLarge"), 413, { actorId: user.id, filename: file.name });
    }
    const languages = parseOcrLanguages(form.getAll("languages").length ? form.getAll("languages") : form.get("language"));
    try {
      await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
    } catch (error) {
      return errorResponse(request, await serverTranslate("error.validPdf"), 400, {
        actorId: user.id,
        cause: error,
        filename: file.name,
      });
    }

    taskId = randomUUID();
    await query(`
      INSERT INTO ocr_task(id,user_id,mode,original_name,source_size_bytes,languages,status)
      VALUES($1,$2,'full',$3,$4,$5,'queued')
    `, [taskId, user.id, file.name, file.size, languages]);
    const serviceJob = await submitOcrJob(taskId, file, languages);
    const task = await syncOcrTask(serviceJob);
    await writeAudit({
      actorId: user.id,
      action: "ocr.full.submit",
      resourceType: "ocr_task",
      resourceId: taskId,
      filename: file.name,
      details: { languages, sizeBytes: file.size },
      request,
    });
    return Response.json({
      task,
      statusUrl: `/api/ocr/jobs/${taskId}`,
      pdfUrl: `/api/ocr/jobs/${taskId}/pdf`,
      textUrl: `/api/ocr/jobs/${taskId}/text`,
    }, { status: 202 });
  } catch (error) {
    if (taskId) await failOcrTask(taskId, error);
    if (error instanceof PdfboxServiceError) {
      return errorResponse(request, await serverTranslate("error.ocrFailed"), error.status, { cause: error });
    }
    return apiError(error, request);
  }
}
