import { deleteSession, getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { apiError } from "@/lib/http";

export async function POST(request: Request) {
  try {
    const user = await getSessionUser();
    await writeAudit({ actorId: user?.id, action: "auth.logout", resourceType: "session", resourceId: user?.id, request });
    await deleteSession();
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, request);
  }
}
