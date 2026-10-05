import "server-only";
import type { SessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getOcrJob, type OcrJobStatus } from "@/lib/pdfbox-service";

export interface OcrTaskRow {
  id: string;
  user_id: string;
  document_id: string | null;
  mode: "page" | "full";
  page_number: number | null;
  original_name: string;
  source_size_bytes: string;
  languages: string[];
  status: "queued" | "processing" | "completed" | "error";
  total_pages: number;
  processed_pages: number;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
}

export async function findOcrTask(user: SessionUser, id: string) {
  const result = await query<OcrTaskRow>(`
    SELECT id,user_id,document_id,mode,page_number,original_name,source_size_bytes,languages,
      status,total_pages,processed_pages,error,created_at,completed_at
    FROM ocr_task
    WHERE id=$1 AND ($3::boolean OR user_id=$2)
  `, [id, user.id, user.isAdmin]);
  return result.rows[0] ?? null;
}

export async function syncOcrTask(job: OcrJobStatus) {
  const status = job.status.toLowerCase();
  const result = await query<OcrTaskRow>(`
    UPDATE ocr_task
    SET status=$2,total_pages=$3,processed_pages=$4,error=$5,
      completed_at=CASE WHEN $2 IN ('completed','error') THEN COALESCE(completed_at,now()) ELSE NULL END
    WHERE id=$1
    RETURNING id,user_id,document_id,mode,page_number,original_name,source_size_bytes,languages,
      status,total_pages,processed_pages,error,created_at,completed_at
  `, [job.id, status, job.totalPages, job.processedPages, job.error]);
  return result.rows[0] ?? null;
}

export async function refreshOcrTask(user: SessionUser, id: string) {
  const task = await findOcrTask(user, id);
  if (!task || task.status === "completed" || task.status === "error") return task;
  return syncOcrTask(await getOcrJob(id));
}

export async function failOcrTask(id: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await query("UPDATE ocr_task SET status='error',error=$2,completed_at=now() WHERE id=$1", [id, message]);
}
