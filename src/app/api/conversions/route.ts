import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await requireUser("pdfs-1");
    const result = await query(`
      SELECT c.id,c.uploaded_at,c.completed_at,c.original_name,c.source_size_bytes,c.status,c.details,
        c.user_id,u.login AS user_login,u.name AS user_name,
        d.id AS document_id,d.page_count,d.size_bytes,d.uploaded_at AS document_uploaded_at,d.document_date
      FROM conversion_task c
      JOIN app_user u ON u.id=c.user_id
      LEFT JOIN pdf_document d ON d.id=c.document_id
      WHERE $2::boolean OR c.user_id=$1
      ORDER BY c.uploaded_at DESC
      LIMIT 500
    `, [user.id, user.isAdmin]);
    return NextResponse.json(result.rows);
  } catch (error) { return apiError(error, request); }
}
