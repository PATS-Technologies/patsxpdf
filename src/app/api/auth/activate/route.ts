import { NextResponse } from "next/server";
import { z } from "zod";
import { activatePassword, createSession } from "@/lib/auth";
import { apiError } from "@/lib/http";
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
      return NextResponse.json({ error: await serverTranslate("error.invalidData") }, { status: 400 });
    }
    const activation = await activatePassword(parsed.data.login, parsed.data.activationCode, parsed.data.password, request);
    if (activation.status !== "valid") {
      await writeAudit({ action: "auth.password.activate", resourceType: "session", outcome: "failure", details: { login: parsed.data.login, reason: activation.status === "expired" ? "expired-code" : "invalid-code" }, request });
      const key = activation.status === "expired" ? "error.expiredActivation" : "error.invalidActivation";
      return NextResponse.json({ error: await serverTranslate(key) }, { status: 400 });
    }
    await createSession(activation.user.id, activation.user.preferredLocale);
    return NextResponse.json({ user: activation.user });
  } catch (error) { return apiError(error); }
}
