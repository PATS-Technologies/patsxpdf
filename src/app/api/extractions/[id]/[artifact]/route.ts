import { requireUser } from "@/lib/auth";
import { refreshExtractionTask } from "@/lib/extraction-tasks";
import { apiError, errorResponse } from "@/lib/http";
import { getExtractionArtifact, PdfboxServiceError } from "@/lib/pdfbox-service";
import { serverTranslate } from "@/lib/i18n-server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; artifact: string }> }) {
  try {
    const user = await requireUser("pdfs-1");
    const { id, artifact } = await params;
    if (artifact !== "text" && artifact !== "json") {
      return errorResponse(request, await serverTranslate("error.invalidData"), 400, { actorId: user.id });
    }
    const task = await refreshExtractionTask(user, id);
    if (!task) return errorResponse(request, await serverTranslate("error.extractionNotFound"), 404, { actorId: user.id });
    if (task.status !== "completed") {
      return errorResponse(request, await serverTranslate("error.extractionIncomplete"), 409, { actorId: user.id });
    }
    const response = await getExtractionArtifact(id, artifact);
    return new Response(response.body, {
      headers: {
        "Content-Type": artifact === "json" ? "application/json" : "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${task.original_name}.${artifact === "json" ? "json" : "txt"}`)}`,
      },
    });
  } catch (error) {
    if (error instanceof PdfboxServiceError) {
      return errorResponse(request, await serverTranslate("error.extractionFailed"), error.status, { cause: error });
    }
    return apiError(error, request);
  }
}
