import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, validateCredentials } from "@/lib/auth";
import { apiError, errorResponse } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { serverTranslate } from "@/lib/i18n-server";

const credentialsSchema = z.object({ login: z.string().trim().min(1), password: z.string().default("") });

export async function POST(request: Request) {
  try {
    const parsed = credentialsSchema.safeParse(await request.json());
    if (!parsed.success) {
      await writeAudit({ action: "auth.login", resourceType: "session", outcome: "failure", details: { reason: "invalid-payload" }, request });
      return errorResponse(request, await serverTranslate("error.credentialsRequired"), 400, { actorId: null, details: { reason: "invalid-payload" } });
    }
    const authentication = await validateCredentials(parsed.data.login, parsed.data.password);
    if (authentication.status === "password-expired") {
      await writeAudit({ action: "auth.password-setup-required", resourceType: "session", details: { login: parsed.data.login }, request });
      return NextResponse.json({ passwordSetupRequired: true }, { status: 409 });
    }
    if (authentication.status === "invalid") {
      await writeAudit({ action: "auth.login", resourceType: "session", outcome: "failure", details: { login: parsed.data.login, reason: "invalid-credentials" }, request });
      return errorResponse(request, await serverTranslate("error.invalidCredentials"), 401, { actorId: null, details: { login: parsed.data.login, reason: "invalid-credentials" } });
    }
    const { user } = authentication;
    await createSession(user.id, user.preferredLocale);
    await writeAudit({ actorId: user.id, action: "auth.login", resourceType: "session", resourceId: user.id, request });
    return NextResponse.json({ user });
  } catch (error) { return apiError(error, request); }
}
