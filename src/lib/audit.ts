import "server-only";
import type { PoolClient } from "pg";
import { query } from "@/lib/db";

export interface AuditEvent {
  actorId?: number | null;
  action: string;
  resourceType: string;
  resourceId?: string | number | null;
  outcome?: "success" | "failure";
  details?: Record<string, unknown>;
  request?: Request;
}

export async function writeAudit(event: AuditEvent, client?: PoolClient) {
  const requestId = event.request?.headers.get("x-request-id") ?? crypto.randomUUID();
  const forwardedFor = event.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const values = [
    event.actorId ?? null,
    event.action,
    event.resourceType,
    event.resourceId == null ? null : String(event.resourceId),
    event.outcome ?? "success",
    requestId,
    forwardedFor || event.request?.headers.get("x-real-ip") || null,
    event.request?.headers.get("user-agent") ?? null,
    event.details ?? {},
  ];
  const sql = `
    INSERT INTO audit_event(actor_id,action,resource_type,resource_id,outcome,request_id,ip_address,user_agent,details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
  `;
  if (client) await client.query(sql, values);
  else await query(sql, values);
}