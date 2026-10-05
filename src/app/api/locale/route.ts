import { NextResponse } from "next/server";
import { z } from "zod";
import { locales } from "@/lib/i18n";
import { getSessionUser } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { apiError, errorResponse } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { setLocaleCookie } from "@/lib/i18n-server";

const schema = z.object({ locale: z.enum(locales) });

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return errorResponse(request, "Invalid locale.", 400, { details: { issues: parsed.error.issues } });
    const user = await getSessionUser();
    if (user) {
      await transaction(async (client) => {
        await client.query("UPDATE app_user SET preferred_locale=$2,updated_at=now() WHERE id=$1", [user.id, parsed.data.locale]);
        await writeAudit({ actorId: user.id, action: "user.locale.update", resourceType: "app_user", resourceId: user.id, details: { preferredLocale: parsed.data.locale }, request }, client);
      });
    }
    await setLocaleCookie(parsed.data.locale);
    return NextResponse.json({ locale: parsed.data.locale });
  } catch (error) {
    return apiError(error, request);
  }
}