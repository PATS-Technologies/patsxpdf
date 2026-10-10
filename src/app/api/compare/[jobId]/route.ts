import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { apiError, errorResponse } from "@/lib/http";
import { serverTranslate } from "@/lib/i18n-server";

const jobIdSchema = z.string().uuid();

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  try {
    await requireUser("pdfs-2");
    const { jobId } = await params;
    const validated = jobIdSchema.safeParse(jobId);
    if (!validated.success) {
      return errorResponse(request, await serverTranslate("error.invalidData"), 400);
    }

    const compareApi = (process.env.PATSCOMPARE_URL || "").replace(/\/+$/, "");
    if (!compareApi) {
      return errorResponse(request, await serverTranslate("error.compareUnavailable"), 503, { details: { missing: "PATSCOMPARE_URL" } });
    }

    const response = await fetch(`${compareApi}/api/compare/${validated.data}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    return Response.json({ ...payload, statusUrl: `/api/compare/${validated.data}` }, { status: response.status });
  } catch (error) {
    return apiError(error, request);
  }
}