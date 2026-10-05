import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { transaction } from "@/lib/db";
import { apiError, errorResponse } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { serverTranslate } from "@/lib/i18n-server";
import { createPasswordActivation } from "@/lib/password-activation";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser("users-9");
    const { id: rawId } = await params;
    const id = Number(rawId);
    const { action } = z.object({ action: z.enum(["toggle-lock", "expire-password"]) }).parse(await request.json());
    if (!id || id === actor.id) return errorResponse(request, await serverTranslate("error.ownAccount"), 400, { actorId: actor.id, details: { userId: id || null } });
    const activation = action === "expire-password" ? await createPasswordActivation() : null;
    await transaction(async (client) => {
      if (action === "toggle-lock") await client.query("UPDATE app_user SET locked=NOT locked,updated_at=now() WHERE id=$1 AND NOT deleted", [id]);
      else await client.query("UPDATE app_user SET password_hash=$2,password_expired=true,activation_code_hash=$3,activation_code_expires_at=$4,updated_at=now() WHERE id=$1 AND NOT deleted", [id, "!UNSET!", activation!.hash, activation!.expiresAt]);
      await writeAudit({ actorId: actor.id, action: action === "toggle-lock" ? "user.toggle-lock" : "user.expire-password", resourceType: "app_user", resourceId: id, request }, client);
    });
    return NextResponse.json({ ok: true, ...(activation ? { activationCode: activation.code, activationExpiresAt: activation.expiresAt } : {}) });
  } catch (error) { return apiError(error, request); }
}
