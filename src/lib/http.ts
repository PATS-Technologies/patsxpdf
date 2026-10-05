import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionUser } from "@/lib/auth";
import { recordError } from "@/lib/error-log";
import { serverTranslate } from "@/lib/i18n-server";

interface ErrorResponseOptions {
  actorId?: number | null;
  cause?: unknown;
  filename?: string | null;
  details?: Record<string, unknown>;
  response?: Record<string, unknown>;
}

export async function errorResponse(request: Request, message: string, status: number, options: ErrorResponseOptions = {}) {
  const actorId = options.actorId === undefined
    ? await getSessionUser().then((user) => user?.id ?? null).catch(() => null)
    : options.actorId;
  await recordError({
    error: options.cause ?? new Error(message),
    statusCode: status,
    request,
    actorId,
    filename: options.filename,
    details: options.details,
  });
  return NextResponse.json({ error: message, ...options.response }, { status });
}

export async function apiError(error: unknown, request: Request, options: Omit<ErrorResponseOptions, "cause"> = {}) {
  if (error instanceof ZodError) return errorResponse(request, await serverTranslate("error.invalidData"), 400, { ...options, cause: error, details: { ...options.details, issues: error.issues } });
  const message = error instanceof Error ? error.message : "Erro interno.";
  if (message === "UNAUTHORIZED") return errorResponse(request, await serverTranslate("error.invalidSession"), 401, { ...options, cause: error });
  if (message === "FORBIDDEN") return errorResponse(request, await serverTranslate("error.accessDenied"), 403, { ...options, cause: error });
  if (message.includes("duplicate key")) return errorResponse(request, await serverTranslate("error.duplicateUser"), 409, { ...options, cause: error });
  console.error(error);
  return errorResponse(request, await serverTranslate("error.internal"), 500, { ...options, cause: error });
}
