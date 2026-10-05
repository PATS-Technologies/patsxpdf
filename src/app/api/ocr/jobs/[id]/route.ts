import { requireUser } from "@/lib/auth";
import { apiError, errorResponse } from "@/lib/http";
import { refreshOcrTask } from "@/lib/ocr-tasks";
import { PdfboxServiceError } from "@/lib/pdfbox-service";
import { serverTranslate } from "@/lib/i18n-server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("pdfs-1");
    const { id } = await params;
    const task = await refreshOcrTask(user, id);
    if (!task) return errorResponse(request, await serverTranslate("error.ocrTaskNotFound"), 404, { actorId: user.id });
    return Response.json(task);
  } catch (error) {
    if (error instanceof PdfboxServiceError) {
      return errorResponse(request, await serverTranslate("error.ocrFailed"), error.status, { cause: error });
    }
    return apiError(error, request);
  }
}
