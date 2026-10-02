import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { apiError } from "@/lib/http";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.coerce.number().int().positive().optional(),
  actorId: z.coerce.number().int().positive().optional(),
  resourceType: z.string().trim().max(80).optional(),
});

export async function GET(request: Request) {
  try {
    await requireUser("audit-1");
    const url = new URL(request.url);
    const filters = querySchema.parse(Object.fromEntries(url.searchParams));
    const result = await query(`
      SELECT a.id,a.occurred_at,a.actor_id,u.login AS actor_login,a.action,a.resource_type,
        a.resource_id,a.outcome,a.request_id,a.ip_address,a.user_agent,a.details
      FROM audit_event a
      LEFT JOIN app_user u ON u.id=a.actor_id
      WHERE ($1::bigint IS NULL OR a.id < $1)
        AND ($2::bigint IS NULL OR a.actor_id = $2)
        AND ($3::text IS NULL OR a.resource_type = $3)
      ORDER BY a.id DESC
      LIMIT $4
    `, [filters.before ?? null, filters.actorId ?? null, filters.resourceType ?? null, filters.limit]);
    return NextResponse.json(result.rows);
  } catch (error) { return apiError(error); }
}