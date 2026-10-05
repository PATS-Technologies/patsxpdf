import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
  statusCode: z.coerce.number().int().min(400).max(599).optional(),
  query: z.string().trim().max(200).optional(),
});

export async function GET(request: Request) {
  try {
    await requireUser("admin");
    const url = new URL(request.url);
    const filters = querySchema.parse(Object.fromEntries(url.searchParams));
    const search = filters.query ? `%${filters.query}%` : null;
    const result = await query(`
      SELECT e.id,e.occurred_at,e.actor_id,u.login AS actor_login,e.route,e.method,e.status_code,
        e.error_name,e.message,e.stack,e.request_id,e.ip_address,e.user_agent,e.filename,e.details
      FROM error_event e
      LEFT JOIN app_user u ON u.id=e.actor_id
      WHERE ($1::bigint IS NULL OR e.id < $1)
        AND ($2::integer IS NULL OR e.status_code = $2)
        AND ($3::text IS NULL OR e.route ILIKE $3 OR e.message ILIKE $3 OR e.filename ILIKE $3 OR e.error_name ILIKE $3)
      ORDER BY e.id DESC
      LIMIT $4
    `, [filters.before ?? null, filters.statusCode ?? null, search, filters.limit]);
    return NextResponse.json(result.rows);
  } catch (error) {
    return apiError(error, request);
  }
}
