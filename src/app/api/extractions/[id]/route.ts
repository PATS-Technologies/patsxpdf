import { requireUser } from "@/lib/auth";
import { formatExtractionId, refreshExtractionTask } from "@/lib/extraction-tasks";
import { apiError, errorResponse } from "@/lib/http";
import { PdfboxServiceError } from "@/lib/pdfbox-service";
import { serverTranslate } from "@/lib/i18n-server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("pdfs-1");
    const { id } = await params;
    const task = await refreshExtractionTask(user, id);
    if (!task) return errorResponse(request, await serverTranslate("error.extractionNotFound"), 404, { actorId: user.id });
    return Response.json({ ...task, display_id: formatExtractionId(task.public_id) });
  } catch (error) {
    if (error instanceof PdfboxServiceError) {
      return errorResponse(request, await serverTranslate("error.extractionFailed"), error.status, { cause: error });
    }
    return apiError(error, request);
  }
}
