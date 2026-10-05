import { NextResponse } from "next/server";
import { z } from "zod";
import { activatePassword, createSession } from "@/lib/auth";
import { apiError, errorResponse } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { serverTranslate } from "@/lib/i18n-server";

const activationSchema = z.object({
  login: z.string().trim().min(1),
  activationCode: z.string().trim().min(1),
  password: z.string().min(5),
});

export async function POST(request: Request) {
  try {
    const parsed = activationSchema.safeParse(await request.json());
    if (!parsed.success) {
      await writeAudit({ action: "auth.password.activate", resourceType: "session", outcome: "failure", details: { reason: "invalid-payload" }, request });
      return errorResponse(request, await serverTranslate("error.invalidData"), 400, { actorId: null, details: { reason: "invalid-payload" } });
    }
    const activation = await activatePassword(parsed.data.login, parsed.data.activationCode, parsed.data.password, request);
    if (activation.status !== "valid") {
      await writeAudit({ action: "auth.password.activate", resourceType: "session", outcome: "failure", details: { login: parsed.data.login, reason: activation.status === "expired" ? "expired-code" : "invalid-code" }, request });
      const key = activation.status === "expired" ? "error.expiredActivation" : "error.invalidActivation";
      return errorResponse(request, await serverTranslate(key), 400, { actorId: null, details: { login: parsed.data.login, reason: activation.status === "expired" ? "expired-code" : "invalid-code" } });
    }
    await createSession(activation.user.id, activation.user.preferredLocale);
    return NextResponse.json({ user: activation.user });
  } catch (error) { return apiError(error, request); }
}
