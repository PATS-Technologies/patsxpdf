import "server-only";
import type { SessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getExtractionArtifact, getOcrJob, type OcrJobStatus } from "@/lib/pdfbox-service";

export interface ExtractionTask {
  id: string;
  public_id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  document_id: string;
  original_name: string;
  requested_pages: number[];
  languages: string[];
  status: "queued" | "processing" | "completed" | "error";
  total_pages: number;
  processed_pages: number;
  used_ocr: boolean | null;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
}

const taskColumns = `
  e.id,e.public_id,e.user_id,u.login AS user_login,u.name AS user_name,e.document_id,e.original_name,
  e.requested_pages,e.languages,e.status,e.total_pages,e.processed_pages,e.used_ocr,e.error,e.created_at,e.completed_at
`;

export function formatExtractionId(value: string | number) {
  return String(value).padStart(12, "0").replace(/(\d{3})(?=\d)/g, "$1.");
}

export async function listExtractionTasks(user: SessionUser) {
  const result = await query<ExtractionTask>(`
    SELECT ${taskColumns}
    FROM extraction_task e JOIN app_user u ON u.id=e.user_id
    WHERE $2::boolean OR e.user_id=$1
    ORDER BY e.created_at DESC LIMIT 500
  `, [user.id, user.isAdmin]);
  return result.rows;
}

export async function findExtractionTask(user: SessionUser, id: string) {
  const result = await query<ExtractionTask>(`
    SELECT ${taskColumns}
    FROM extraction_task e JOIN app_user u ON u.id=e.user_id
    WHERE e.id=$1 AND ($3::boolean OR e.user_id=$2)
  `, [id, user.id, user.isAdmin]);
  return result.rows[0] ?? null;
}

export async function syncExtractionTask(task: ExtractionTask, job: OcrJobStatus) {
  let usedOcr = task.used_ocr;
  if (job.status === "COMPLETED" && usedOcr === null) {
    const artifact = await getExtractionArtifact(task.id, "json");
    const result = await artifact.json() as { pages?: { usedOcr?: boolean }[] };
    usedOcr = result.pages?.some((page) => page.usedOcr) ?? false;
  }
  const result = await query<ExtractionTask>(`
    UPDATE extraction_task
    SET status=$2::varchar,processed_pages=$3,error=$4,used_ocr=$5,
      completed_at=CASE WHEN $2::varchar IN ('completed','error') THEN COALESCE(completed_at,now()) ELSE NULL END
    WHERE id=$1
    RETURNING id,public_id,user_id,document_id,original_name,
      requested_pages,languages,status,total_pages,processed_pages,used_ocr,error,created_at,completed_at
  `, [task.id, job.status.toLowerCase(), job.processedPages, job.error, usedOcr]);
  return { ...task, ...result.rows[0] };
}

export async function refreshExtractionTask(user: SessionUser, id: string) {
  const task = await findExtractionTask(user, id);
  if (!task || task.status === "completed" || task.status === "error") return task;
  return syncExtractionTask(task, await getOcrJob(id));
}
