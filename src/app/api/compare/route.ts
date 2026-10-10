import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { apiError, errorResponse } from "@/lib/http";
import { serverTranslate } from "@/lib/i18n-server";

const schema = z.object({
  firstId: z.string().uuid(),
  secondId: z.string().uuid(),
  OFFSET: z.number().int().min(0).max(9).optional(),
  FATSIM: z.number().min(0.1).max(1).optional(),
  POSFIXA: z.boolean().optional(),
  MAX_PAGES: z.number().int().min(0).max(9999999).optional(),
});

interface CompareStartResponse {
  jobId?: string;
  error?: string;
  uploads?: { a?: { url?: string }; b?: { url?: string } };
}

interface CompareCommitResponse {
  jobId?: string;
  status?: string;
  error?: string;
}

export async function POST(request: Request) {
  try {
    const user = await requireUser("pdfs-2");
    const input = schema.parse(await request.json());
    if (input.firstId === input.secondId) {
      return errorResponse(request, await serverTranslate("error.invalidData"), 400, { actorId: user.id });
    }

    const compareApi = (process.env.PATSCOMPARE_URL || "").replace(/\/+$/, "");
    if (!compareApi) {
      return errorResponse(request, await serverTranslate("error.compareUnavailable"), 503, { actorId: user.id, details: { missing: "PATSCOMPARE_URL" } });
    }

    const result = await query<{ id: string; storage_name: string; original_name: string }>(
      "SELECT id,storage_name,original_name FROM pdf_document WHERE id IN ($1,$2)",
      [input.firstId, input.secondId],
    );
    const documents = new Map(result.rows.map((document) => [document.id, document]));
    const first = documents.get(input.firstId);
    const second = documents.get(input.secondId);
    if (!first || !second) {
      return errorResponse(request, await serverTranslate("error.pdfNotFound"), 404, { actorId: user.id });
    }

    const storagePath = process.env.PDF_STORAGE ?? path.join(process.cwd(), "data", "pdfs");
    const [aBytes, bBytes] = await Promise.all([
      readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ storagePath, first.storage_name)),
      readFile(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ storagePath, second.storage_name)),
    ]);
    const filenameA = `${path.parse(first.original_name).name}.pdf`;
    const filenameB = `${path.parse(second.original_name).name}.pdf`;

    const startResponse = await fetch(`${compareApi}/api/compare/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `${first.original_name} x ${second.original_name}`,
        filenameA,
        filenameB,
        OFFSET: input.OFFSET ?? 3,
        FATSIM: input.FATSIM ?? 0.7,
        POSFIXA: input.POSFIXA ?? false,
        MAX_PAGES: input.MAX_PAGES ?? 0,
      }),
      cache: "no-store",
    });
    const start = await startResponse.json().catch(() => ({})) as CompareStartResponse;
    if (!startResponse.ok || !start.jobId || !start.uploads?.a?.url || !start.uploads?.b?.url) {
      throw new Error(start.error ?? (await serverTranslate("error.internal")));
    }

    await Promise.all([
      fetch(start.uploads!.a!.url!, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: aBytes }),
      fetch(start.uploads!.b!.url!, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: bBytes }),
    ]);

    const commitResponse = await fetch(`${compareApi}/api/compare/${start.jobId}`, {
      method: "POST",
      cache: "no-store",
    });
    const commit = await commitResponse.json().catch(() => ({})) as CompareCommitResponse;
    const jobId = commit.jobId ?? start.jobId;
    if (!commitResponse.ok || commit.status !== "queued" || !jobId) {
      throw new Error(commit.error ?? (await serverTranslate("error.internal")));
    }

    await writeAudit({
      actorId: user.id,
      action: "compare.submit",
      resourceType: "comparison",
      resourceId: jobId,
      filename: `${first.original_name} x ${second.original_name}`,
      details: {
        firstId: input.firstId,
        secondId: input.secondId,
        OFFSET: input.OFFSET ?? 3,
        FATSIM: input.FATSIM ?? 0.7,
        POSFIXA: input.POSFIXA ?? false,
        MAX_PAGES: input.MAX_PAGES ?? 0,
      },
      request,
    });

    return Response.json(
      { jobId, status: "queued", statusUrl: `/api/compare/${jobId}` },
      { status: 202 },
    );
  } catch (error) {
    return apiError(error, request);
  }
}