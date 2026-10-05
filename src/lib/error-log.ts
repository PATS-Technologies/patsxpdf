import "server-only";
import { query } from "@/lib/db";

interface RequestMetadata {
  path: string;
  method: string;
  headers: Headers | NodeJS.Dict<string | string[]>;
}

export interface ErrorEvent {
  error: unknown;
  statusCode: number;
  request?: Request;
  requestMetadata?: RequestMetadata;
  actorId?: number | null;
  filename?: string | null;
  details?: Record<string, unknown>;
}

function headerValue(headers: RequestMetadata["headers"], name: string) {
  if (headers instanceof Headers) return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function requestId(headers: RequestMetadata["headers"]) {
  const value = headerValue(headers, "x-request-id");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : crypto.randomUUID();
}

export async function writeErrorEvent(event: ErrorEvent) {
  const metadata = event.request
    ? { path: new URL(event.request.url).pathname, method: event.request.method, headers: event.request.headers }
    : event.requestMetadata ?? { path: "unknown", method: "UNKNOWN", headers: {} };
  const forwardedFor = headerValue(metadata.headers, "x-forwarded-for")?.split(",")[0]?.trim();
  const error = event.error instanceof Error ? event.error : new Error(String(event.error));
  await query(`
    INSERT INTO error_event(actor_id,route,method,status_code,error_name,message,stack,request_id,ip_address,user_agent,filename,details)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    event.actorId ?? null,
    metadata.path,
    metadata.method,
    event.statusCode,
    error.name || "Error",
    error.message,
    error.stack ?? null,
    requestId(metadata.headers),
    forwardedFor || headerValue(metadata.headers, "x-real-ip") || null,
    headerValue(metadata.headers, "user-agent"),
    event.filename ?? null,
    event.details ?? {},
  ]);
}

export async function recordError(event: ErrorEvent) {
  try {
    await writeErrorEvent(event);
  } catch (loggingError) {
    console.error("Failed to persist error event", loggingError);
  }
}
