import { requireUser } from "@/lib/auth";
import { apiError, errorResponse } from "@/lib/http";
import { refreshOcrTask } from "@/lib/ocr-tasks";
import { getOcrArtifact, PdfboxServiceError } from "@/lib/pdfbox-service";
import { serverTranslate } from "@/lib/i18n-server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser("pdfs-1");
    const { id } = await params;
    const task = await refreshOcrTask(user, id);
    if (!task) return errorResponse(request, await serverTranslate("error.ocrTaskNotFound"), 404, { actorId: user.id });
    if (task.status !== "completed") {
      return errorResponse(request, await serverTranslate("error.ocrTaskIncomplete"), 409, { actorId: user.id });
    }
    const artifact = await getOcrArtifact(id, "text");
    return Response.json({ text: await artifact.text() });
  } catch (error) {
    if (error instanceof PdfboxServiceError) {
      return errorResponse(request, await serverTranslate("error.ocrFailed"), error.status, { cause: error });
    }
    return apiError(error, request);
  }
}
